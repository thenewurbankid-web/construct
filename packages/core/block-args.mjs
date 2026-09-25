// #629, #630, #625 (part of epic #616) -- the closed choices and the argument rules of the guard, store and handler blocks, in a module that imports
// nothing: the plan validator (plan.mjs) reads them, and so do the blocks themselves (guard.mjs, store.mjs, handler.mjs), so a plan, the CLI and the
// Requirement chain cannot disagree about what a valid request is.
//
//   GUARD_ACCESS, STORE_SHAPES, HANDLER_METHODS   the closed choices (a step's `access`, `shape` and `method`)
//   rolesOf(roles)                                 a list of roles from an array or a comma separated text
//   guardArgIssue(args) / storeArgIssue(args) / handlerArgIssue(args)   the first reason a request is invalid and which argument it is about, or null

/** A feature name as every flow of the chain accepts it. */
export const FEATURE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** A PascalCase unit name. */
export const UNIT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

/** The three accesses of a route guard, a closed choice: nobody is asked to type a rule. */
export const GUARD_ACCESS = Object.freeze(['public', 'signed-in', 'role']);

/** A role: lower-case letters, digits, `-` and `_`, starting with a letter. At most `MAX_ROLES` of them. */
export const ROLE_RE = /^[a-z][a-z0-9_-]{0,30}$/;
export const MAX_ROLES = 6;

/** The three shapes of a client-state store, a closed choice: one value, a list with a selection, a keyed map. */
export const STORE_SHAPES = Object.freeze(['value', 'list', 'keyed']);

/** The HTTP methods a route handler answers, a closed choice. */
export const HANDLER_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'DELETE']);

const ROUTE_RE = /^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const REDIRECT_RE = /^\/[A-Za-z0-9._~\-/]{0,120}$/;
/** The path of an API route handler: `/api/` and lower-case segments (no dynamic segment: `[id]` is a later slice). */
export const HANDLER_PATH_RE = /^\/api(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const FIELDS_RE = /^[a-z][A-Za-z0-9]*:(?:string|number|boolean)(?:,[a-z][A-Za-z0-9]*:(?:string|number|boolean))*$/;

/**
 * The roles of a request as a list: an array, or a comma separated text.
 *
 * @param {unknown} roles The roles.
 * @returns {string[]} The trimmed, non-empty roles.
 *
 * @example
 * rolesOf('admin, manager'); // => ['admin', 'manager']
 */
export function rolesOf(roles) {
  return (Array.isArray(roles) ? roles : typeof roles === 'string' ? roles.split(',') : []).map((r) => String(r).trim()).filter(Boolean);
}

const nameIssue = (name, what) => (typeof name !== 'string' || !UNIT_NAME_RE.test(name) ? { arg: 'name', message: what } : null);
const featureIssue = (feature) => (typeof feature !== 'string' || !FEATURE_NAME_RE.test(feature) ? { arg: 'feature', message: 'A feature name uses letters, digits, "_" and "-" only.' } : null);
const entityIssue = (entity, fields) => {
  if (entity !== undefined && (typeof entity !== 'string' || !UNIT_NAME_RE.test(entity))) return { arg: 'entity', message: 'An entity is named in PascalCase and singular, like Product.' };
  if (fields !== undefined && (typeof fields !== 'string' || !FIELDS_RE.test(fields) || !fields.split(',').some((f) => f.startsWith('id:')))) return { arg: 'fields', message: 'Fields are name:type pairs (string, number or boolean) separated by commas, with an id field: id:string,name:string.' };
  return null;
};

/**
 * The first reason a `guard.route` request is not valid, and which argument it is about, or `null`. Pure: nothing is read from the disk.
 * The name is PascalCase, the feature a feature name, the access one of `public`, `signed-in`, `role`; `role` needs one to six roles and the
 * other two take none; a redirect and a route are plain paths.
 *
 * @param {{ name?: unknown, feature?: unknown, access?: unknown, roles?: unknown, redirect?: unknown, route?: unknown }} args The request.
 * @returns {{ arg: string, message: string } | null} The problem in plain words and its argument, or `null` when the request is valid.
 *
 * @example
 * guardArgIssue({ name: 'Products', feature: 'shop', access: 'role' })?.arg; // => 'roles'
 */
export function guardArgIssue(args) {
  const { name, feature, access, roles, redirect, route } = args ?? {};
  const bad = nameIssue(name, 'A guarded screen is named in PascalCase, like Products (the name of its controller without "Controller").') ?? featureIssue(feature);
  if (bad) return bad;
  if (!GUARD_ACCESS.includes(access)) return { arg: 'access', message: `The access is one of: ${GUARD_ACCESS.join(', ')}.` };
  const list = rolesOf(roles);
  if (access === 'role') {
    if (!list.length) return { arg: 'roles', message: 'The role access needs the roles that may open the screen (--roles admin,manager).' };
    if (list.length > MAX_ROLES || new Set(list).size !== list.length || !list.every((r) => ROLE_RE.test(r))) return { arg: 'roles', message: `Roles are one to ${MAX_ROLES} different lower-case words (letters, digits, "-" and "_"), like admin,manager.` };
  } else if (roles !== undefined && list.length) return { arg: 'roles', message: `Roles only belong to the role access; ${access} takes none.` };
  if (redirect !== undefined && (typeof redirect !== 'string' || !REDIRECT_RE.test(redirect))) return { arg: 'redirect', message: 'A redirect is a path on this site, like /sign-in.' };
  if (route !== undefined && (typeof route !== 'string' || !ROUTE_RE.test(route))) return { arg: 'route', message: 'A route is lowercase segments like /products or /shop/products.' };
  return null;
}

/**
 * The first reason a `create.store` request is not valid, and which argument it is about, or `null`. Pure. The name is PascalCase (`Cart` gives `useCartState`), the shape one of
 * `value`, `list`, `keyed`, the entity PascalCase, the fields `name:type` pairs with an `id`.
 *
 * @param {{ name?: unknown, feature?: unknown, shape?: unknown, entity?: unknown, fields?: unknown }} args The request.
 * @returns {{ arg: string, message: string } | null} The problem in plain words and its argument, or `null` when the request is valid.
 *
 * @example
 * storeArgIssue({ name: 'Cart', feature: 'shop', shape: 'bag' })?.arg; // => 'shape'
 */
export function storeArgIssue(args) {
  const { name, feature, shape, entity, fields } = args ?? {};
  const bad = nameIssue(name, 'A store is named in PascalCase, like Cart (its hook is useCartState).') ?? featureIssue(feature);
  if (bad) return bad;
  if (!STORE_SHAPES.includes(shape)) return { arg: 'shape', message: `The shape of a store is one of: ${STORE_SHAPES.join(', ')} (one value, a list with a selection, a keyed map).` };
  return entityIssue(entity, fields);
}

/**
 * The first reason a `create.handler` request is not valid, and which argument it is about, or `null`. Pure. The name is PascalCase, the method one of `GET`, `POST`, `PUT`, `DELETE`,
 * the path `/api/` and lower-case segments, the service (when given) a PascalCase unit name.
 *
 * @param {{ name?: unknown, feature?: unknown, method?: unknown, path?: unknown, service?: unknown, entity?: unknown, fields?: unknown }} args The request.
 * @returns {{ arg: string, message: string } | null} The problem in plain words and its argument, or `null` when the request is valid.
 *
 * @example
 * handlerArgIssue({ name: 'Products', feature: 'shop', method: 'GET', path: '/products' })?.arg; // => 'path'
 */
export function handlerArgIssue(args) {
  const { name, feature, method, path, service, entity, fields } = args ?? {};
  const bad = nameIssue(name, 'A handler is named in PascalCase, like Products.') ?? featureIssue(feature);
  if (bad) return bad;
  if (!HANDLER_METHODS.includes(method)) return { arg: 'method', message: `The method is one of: ${HANDLER_METHODS.join(', ')}.` };
  if (typeof path !== 'string' || !HANDLER_PATH_RE.test(path)) return { arg: 'path', message: 'A handler path starts with /api/ and has lower-case segments, like /api/products (a dynamic segment such as [id] is not supported yet).' };
  if (service !== undefined && (typeof service !== 'string' || !UNIT_NAME_RE.test(service))) return { arg: 'service', message: 'A service is named as its unit, in PascalCase, like Products (the file features/<feature>/services/Products.service.ts).' };
  return entityIssue(entity, fields);
}
