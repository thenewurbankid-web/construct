import { billingRules } from '../domain/billingRules';
import { billingRequest } from '../services/billingService';

export const billingWorkflow = { rules: billingRules, request: billingRequest };
