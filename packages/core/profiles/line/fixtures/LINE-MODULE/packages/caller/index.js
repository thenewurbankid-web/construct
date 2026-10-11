import { decide as viaPath } from "../reason/decide.js";
import { decide as viaDeepName } from "@mx/reason/decide.js";
import { decide } from "@mx/reason";
import "@mx/reason/contract";
import { ping } from "../notyped";
export const call = (prompt) => decide(prompt) ?? viaPath(prompt) ?? viaDeepName(prompt) ?? ping();
