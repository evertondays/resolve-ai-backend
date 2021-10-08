const sql = require('mssql');
const azureStorage = require('azure-storage');
const getStream = require('into-stream');
const getBlobName = require('../utils/getBlobName');

const Problem = require('../models/ProblemModel');


const locationValidation = require('../utils/locationValidation');
const blobService = azureStorage.createBlobService();

class ProblemController {
	async create(req, res) {
		try {
			const problem = new Problem(req.body.title, req.body.description);

			// Descobrindo a cidade onde está localizado o problema
			let city = '';
			if (req.body.latitude && req.body.longitude) {
				console.log('okay')
				city = await locationValidation(req.body.latitude, req.body.longitude);
				if (city == false) {
					res.json({ error: 'Não estamos nessa cidade' });
					return;
				}
			}

			// Cadastro das imagens
			const imagesName = [];
			let imageContainer = process.env.IMAGES_STORAGE_CONTAINER;
			let imageUrl = process.env.STORAGE_URL;

			if (req.files.length != 0) {
				let imageName = '';

				req.files.forEach((image) => {
					imageName = getBlobName(image.originalname);

					const stream = getStream(image.buffer);
					const streamLength = image.buffer.length;

					blobService.createBlockBlobFromStream(imageContainer, imageName, stream, streamLength, err => {
						if (err) {
							handleError(err);
							return;
						}
					});

					imagesName.push(imageName);
				});
			}

			// Envio para o servidor das informações
			const pool = await sql.connect(require('../config/databaseConfig'));
			const request = pool.request();

			request.input('title', sql.VarChar, problem.title);
			request.input('description', sql.VarChar, problem.description);
			request.input('city', sql.VarChar, city);
			request.input('lat', sql.VarChar, req.body.latitude);
			request.input('lon', sql.VarChar, req.body.longitude);

			const query = await request.query`INSERT INTO Problems (Title, Description, City, Latitude, Longitude) 
				VALUES (@title, @description, @city, @lat, @lon)`;

			// Pegando ID do problema inserido
			let problemId = await request.query`SELECT TOP 1 ID FROM Problems ORDER BY ID DESC`;
			problemId = problemId.recordset[0].ID;

			// Cadastro das imagens no servidor SQL
			if (imagesName.length != 0) {
				var newImagesName = imagesName.map((name, index) => {
					let newImageName = `${imageUrl}/${imageContainer}/${name}`;

					request.input(`nameInput${index}`, sql.VarChar, newImageName);
					request.query('INSERT INTO ProblemImages (name, problemId) VALUES (@nameInput' + index + ', ' + problemId + ')');
					// OBS.: Não utilize Template Strings neste caso pois gera um erro no SQL

					return newImageName;
				});
			}

			// Registro de problema na conta do usuário
			request.input('email', sql.VarChar, req.headers.email);
			request.query`INSERT INTO ProblemUser (Account, ProblemID) VALUES (@email, ${problemId})`;

			// Mandando o registro de volta para o front-end
			const responseData = await request.query(`SELECT * FROM Problems WHERE ID = ${problemId}`);

			res.status(201).json({ data: responseData.recordset[0], images: newImagesName });
		} catch (err) {
			console.error(err);
			res.json({ error: 'Preenchimento inválido de informações!', type: err });
			return;
		}
	}

	async list(req, res) {
		const pool = await sql.connect(require('../config/databaseConfig'));
		const request = pool.request();
		const dataResponse = await request.query(`SELECT * FROM Problems`);

		var data = dataResponse.recordset;

		// Pegando as imagens de cada problema
		const imagesPromise = data.map((problem) => {
			let newRequest = request.query(`SELECT Name FROM ProblemImages WHERE ProblemID = ${problem.ID}`);
			return newRequest;
		});
		const images = await Promise.all(imagesPromise);

		const response = images.map((image, index) => {
			let responseImage = image.recordset.map((object) => {
				if (object.Name) {
					return object.Name
				}
			});

			return { data: data[index], images: responseImage }
		});

		res.json(response);
	}

	async listInCity(req, res) {
		const pool = await sql.connect(require('../config/databaseConfig'));
		const request = pool.request();

		request.input('city', sql.VarChar, req.params.city);
		const dataResponse = await request.query(`SELECT * FROM Problems WHERE city = @city`);

		var data = dataResponse.recordset;

		// Pegando as imagens de cada problema
		const imagesPromise = data.map((problem) => {
			let newRequest = request.query(`SELECT Name FROM ProblemImages WHERE ProblemID = ${problem.ID}`);
			return newRequest;
		});
		let images = await Promise.all(imagesPromise);

		const response = images.map((image, index) => {
			let responseImage = image.recordset.map((object) => {
				if (object.Name) {
					return object.Name
				}
			});

			return { data: data[index], images: responseImage }
		});

		res.json(response);
	}
}

module.exports = ProblemController;