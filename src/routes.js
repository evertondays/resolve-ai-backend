const routes = require('express').Router();

const multer = require('multer');
const uploadImage = multer(require('./config/multerImage'));

const UserController = require('./controllers/UserController');
const userController = new UserController();
const ProblemController = require('./controllers/ProblemController');
const problemController = new ProblemController();
const CommentController = require('./controllers/CommentController');
const commentController = new CommentController();

const authenticate = require('./utils/authenticateRequest');

routes.get('/test', (req, res) => res.json({ status: 'O serviço da API está ativo!' }));

/// Usuario
routes.post('/create-user', uploadImage.single('picture'), (req, res) => userController.create(req, res));
routes.post('/login', (req, res) => userController.authentication(req, res));
routes.post('/validate', (req, res) => userController.validate(req, res));
routes.delete('/logout', (req, res) => userController.logout(req, res));
routes.get('/user-problems', authenticate, (req, res) => userController.getUserProblems(req, res));

// Problemas
routes.post('/create-problem', authenticate, uploadImage.array('images[]', 5),
	(req, res) => problemController.create(req, res));
routes.get('/list-problems/', authenticate, (req, res) => problemController.list(req, res));
routes.get('/list-problems/:city', authenticate, (req, res) => problemController.listInCity(req, res));
routes.get('/search/title/:title', authenticate, (req, res) => problemController.searchTitle(req, res));

// Comentarios
routes.post('/create-comment', authenticate, (req, res) => commentController.createComment(req, res));
routes.get('/comment/:id', authenticate, (req, res) => commentController.listComments(req, res));
routes.delete('/comment/:commentId/problem/:problemId', authenticate, (req, res) => commentController.deleteComment(req, res));
routes.post('/report-comment/:commentId/problem/:problemId', authenticate, (req, res) => commentController.reportComment(req, res));


module.exports = routes;