const { poolPromise, sql } = require('../database');

async function authenticateUser(req, res, next) {
	if (!req.headers.token || !req.headers.email) {
		res.status(401).json({ error: 'Informações de autenticação não encontradas!' });

	} else {
		const pool = await poolPromise;
		const request = pool.request();

		request.input('token', sql.VarChar, req.headers.token);
		request.input('email', sql.VarChar, req.headers.email);

		const result = await request.query`SELECT * FROM Authentications
			WHERE @token = Token AND @email = Account`;

		if (result.rowsAffected == 1) {
			next();
		} else {
			res.status(401).json({ error: 'Credenciais inválidas!' });
		}
	}
}

module.exports = authenticateUser;