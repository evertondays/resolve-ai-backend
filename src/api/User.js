const { poolPromise, sql } = require('../database');
const azureStorage = require('azure-storage');
const getStream = require('into-stream');
const cryptoJS = require('crypto-js');

const User = require('../models/UserModel');
const encrypt = require('../utils/encryptSha');
const getBlobName = require('../utils/getBlobName');
const errorHandling = require('../utils/errorHandling');

const blobService = azureStorage.createBlobService();

const { BlobServiceClient } = require("@azure/storage-blob");

class UserController {
	async create(req, res) {
		try {
			const user = new User(req.body.name, req.body.email, req.body.city, req.body.pass);
			user.pass = encrypt(user.pass);

			const pool = await poolPromise;

			// Teste para ver se o email já está cadastrado
			const emailValidateRequest = pool.request();

			emailValidateRequest.input('newEmail', sql.VarChar, req.body.email);
			const emailResult = await emailValidateRequest.query`SELECT Email FROM Users WHERE Email = @newEmail`;

			if (emailResult.rowsAffected >= 1) {
				throw 'Email já cadastrado!';
			}

			// Teste para ver se a cidade pode ser cadastrada
			const cityValidateRequest = pool.request();

			cityValidateRequest.input('newCity', sql.VarChar, req.body.city);
			const cityResult = await cityValidateRequest.query`SELECT Name FROM City WHERE Name = @newCity`;

			if (cityResult.rowsAffected != 1) {
				throw 'Não estamos nessa cidade';
			}

			// Cadastro da imagem de perfil
			let imageName = '';
			let imageContainer = '';

			if (typeof req.file === 'undefined') { // cadastro de imagem padrão
				imageName = 'default-user-image.png';
				imageContainer = 'project';
			} else { // envio de imagem do usuário
				imageName = getBlobName(req.file.originalname);
				imageContainer = process.env.IMAGES_STORAGE_CONTAINER;
				const stream = getStream(req.file.buffer);
				const streamLength = req.file.buffer.length;

				blobService.createBlockBlobFromStream(imageContainer, imageName, stream, streamLength, err => {
					if (err) {
						handleError(err);
						return;
					}
				});
			}

			// Envio para o servidor
			const request = pool.request();

			request.input('name', sql.VarChar, user.name);
			request.input('email', sql.VarChar, user.email);
			request.input('city', sql.VarChar, user.city);
			request.input('picture', sql.VarChar, `${process.env.STORAGE_URL}/${imageContainer}/${imageName}`);
			request.input('pass', sql.VarChar, user.pass);

			request.query`INSERT INTO Users (Name, Email, City, Picture, Pass) VALUES 
				(@name, @email, @city, @picture, @pass)`;

			res.sendStatus(201);

		} catch (err) {
			errorHandling(err, res);
		}
	}

	async editPhoto(req, res) {
		try {
			// Caso não tenha enviado uma imagem
			if (typeof req.file === 'undefined') {
				throw 'Sem arquivo de imagem!';
			}

			// Deletando imagem antiga
			const pool = await poolPromise;
			const request = pool.request();
			request.input('email', sql.VarChar, req.headers.email);

			// Pegando nome da imagem antiga
			const oldImageRequest = await request.query`SELECT Picture FROM Users WHERE Email = @email`;
			const oldImageImageUrl = oldImageRequest.recordset[0].Picture;
			let split = oldImageImageUrl.split('/');
			const oldImageName = split[split.length - 1];

			if (oldImageName != `${process.env.STORAGE_URL}/project/default-user-image.png`) {
				// Deletando imagem antiga
				const blobServiceClient = await BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
				const containerClient = await blobServiceClient.getContainerClient(process.env.IMAGES_STORAGE_CONTAINER);
				containerClient.deleteBlob(oldImageName);
			}

			// Upload da nova imagem de perfil
			const imageName = getBlobName(req.file.originalname);
			const imageContainer = process.env.IMAGES_STORAGE_CONTAINER;
			const stream = getStream(req.file.buffer);
			const streamLength = req.file.buffer.length;

			blobService.createBlockBlobFromStream(imageContainer, imageName, stream, streamLength, err => {
				if (err) {
					handleError(err);
					return;
				}
			});

			request.input('newImage', sql.VarChar, `${process.env.STORAGE_URL}/${imageContainer}/${imageName}`);

			// Editando no banco de dados
			request.query`UPDATE Users SET Picture = @newImage WHERE Email = @email`;

			res.sendStatus(200);
		} catch (err) {
			errorHandling(err, res);
		}
	}

	async authentication(req, res) {
		try {
			const pool = await poolPromise;
			const request = pool.request();

			request.input('email', sql.VarChar, req.body.email.toLowerCase());
			request.input('pass', sql.VarChar, encrypt(req.body.pass));

			const user = await request.query`SELECT * FROM Users WHERE Email = @email AND Pass = @pass`;

			if (user.rowsAffected == 1) { // Autenticado
				if (req.body.type == 'mobile' || req.body.type == 'desktop') {
					const token = cryptoJS.MD5(Math.random().toString().replace(/0\./, '')).toString();
					request.query`INSERT INTO Authentications
					(Token, Account, AccountType, CreateDate)
					VALUES (${token}, @email, ${req.body.type}, GETDATE())`;

					res.json({
						token: token,
						email: user.recordset[0].Email,
						picture: user.recordset[0].Picture,
						name: user.recordset[0].Name,
					})
				} else {
					throw 'Tipo de conta inválida';
				}
			} else { // Não autenticado
				throw 'Credenciais invalidas!';
			}
			
		} catch (err) {
			errorHandling(err, res);
		}
	}

	async validate(req, res) {
		try {
			const pool = await poolPromise;
			const request = pool.request();

			request.input('email', sql.VarChar, req.body.email.toLowerCase());
			request.input('token', sql.VarChar, req.body.token);

			const validate = await request.query`SELECT * FROM Authentications
			WHERE Account = @email AND Token = @token`;

			if (validate.rowsAffected == 1) { // Autenticado
				const user = await request.query`SELECT * FROM Users WHERE Email = @email`;

				res.json({
					picture: user.recordset[0].Picture,
					name: user.recordset[0].Name,
				})
			} else { // Não autenticado
				throw 'Credenciais invalidas!';
			}
		} catch (err) {
			errorHandling(err, res);
		}
	}

	async logout(req, res) {
		try {
			const pool = await poolPromise;
			const request = pool.request();

			request.input('token', sql.VarChar, req.body.token);
			request.input('email', sql.VarChar, req.body.email);

			const response = await request.query`DELETE FROM Authentications 
			WHERE account = @email AND token = @token`;

			if (response.rowsAffected == 1) {
				res.sendStatus(200);
			} else {
				throw 'Credenciais invalidas!';
			}

		} catch (err) {
			errorHandling(err, res);
		}
	}

	async userInfo(req, res) {
		const pool = await poolPromise;
		const request = pool.request();

		request.input('email', sql.VarChar, req.headers.email);

		const problems = await request.query`SELECT ID FROM ProblemUser WHERE Account = @email`;
		const comments = await request.query`SELECT ID FROM Comments WHERE UserEmail = @email`;
		const relevance = await request.query`SELECT ID FROM UsersRelevance WHERE UserEmail = @email`;

		let interactions = comments.rowsAffected[0] + relevance.rowsAffected[0];

		res.json({ problems: problems.rowsAffected[0], interactions: interactions });
	}
}

module.exports = UserController;