// Encaminha qualquer erro (síncrono ou de Promise) de uma rota async pro
// middleware de erro central, sem precisar repetir try/catch em cada rota.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
