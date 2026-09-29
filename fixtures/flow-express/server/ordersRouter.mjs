import express from 'express';
import * as OrdersController from '../features/orders/controllers/OrdersController.mjs';

export const ordersRouter = express.Router();
ordersRouter.get('/', OrdersController.list);
ordersRouter.get('/open-count', OrdersController.openCount);
