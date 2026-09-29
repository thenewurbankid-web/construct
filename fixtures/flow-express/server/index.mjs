import express from 'express';
import * as BillingController from '../features/billing/controllers/BillingController.mjs';
import { ordersRouter } from './ordersRouter.mjs';

const app = express();
app.get('/billing', BillingController.list);
app.get('/billing/total', BillingController.total);
app.use('/orders', ordersRouter);

app.listen(3000);
