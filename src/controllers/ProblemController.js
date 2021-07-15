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
			const city= await locationValidation(req.body.latitude, req.body.longitude);
			if (city == false) {
				res.json({ error: 'Não estamos nessa cidade' });
				return;
			}

			// Cadastro das imagens
			const imagesName = [];

			if (req.files.length != 0) {
				let imageName = '';
				let imageContainer = '';

				req.files.forEach((image) => {
					imageName = getBlobName(image.originalname)
					imageContainer = process.env.IMAGES_STORAGE_CONTAINER;
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
			request.input('lat', sql.Real, req.body.latitude);
			request.input('lon', sql.Real, req.body.longitude);

			request.query`INSERT INTO Problems (Title, Description, City, Latitude, Longitude) 
				VALUES (@title, @description, @city, @lat, @lon)`;

			// Pegando ID do problema inserido
			let problemId = await request.query`SELECT IDENT_CURRENT('Problems') as lastId`;
			problemId = problemId.recordset[0].lastId;

			// Cadastro das imagens no servidor SQL
			if (imagesName.length != 0) {
				imagesName.forEach((name, index) => {
					request.input(`nameInput${index}`, sql.VarChar, name);
					request.query('INSERT INTO ProblemImages (name, problemId) VALUES (@nameInput' + index + ', ' + problemId + ')');
					// OBS.: Não utilize Template Strings neste caso pois gera um erro no SQL
				});
			}

			// Registro de problema na conta do usuário
			request.input('email', sql.VarChar, req.headers.email);
			request.query`INSERT INTO ProblemUser (Account, ProblemID) VALUES (@email, ${problemId})`;

			res.sendStatus(201);
		} catch (err) {
			console.error(err);
			res.json({ error: 'Preenchimento inválido de informações!', type: err });
			return;
		}
	}

	async list(req, res){
		const pool = await sql.connect(require('../config/databaseConfig'));
		const request = pool.request();
		var dataResponse;

		// Verificando se a requisição quer em uma cidade especifica
		if(req.body.city){
			request.input('city', sql.VarChar, req.body.city);
			dataResponse = await request.query(`SELECT * FROM Problems WHERE city = @city`);	
		} else {
			dataResponse = await request.query(`SELECT * FROM Problems`);
		}
		

		var data = dataResponse.recordset;

		// Pegando as imagens de cada problema
		const imagesPromise = data.map((problem) => {
			let newRequest = request.query(`SELECT * FROM ProblemImages WHERE ProblemID = ${problem.ID}`);
			return newRequest;
		});
		const images = await Promise.all(imagesPromise);

		const response = images.map((image, index) => {
			return { data: data[index], images: image.recordset}
		});

		res.json(response);
	}
}

module.exports = ProblemController;