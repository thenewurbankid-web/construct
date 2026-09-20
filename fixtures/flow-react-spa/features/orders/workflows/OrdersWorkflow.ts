import { ordersRules } from '../domain/ordersRules';
import { ordersRequest } from '../services/ordersService';

export const ordersWorkflow = { rules: ordersRules, request: ordersRequest };
