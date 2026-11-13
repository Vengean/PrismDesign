import type {RequestHandler} from 'express';
// Express 4 does not forward rejected async handlers to its error middleware.
export function asyncHandler(handler:RequestHandler):RequestHandler{
 return(req,res,next)=>{Promise.resolve().then(()=>handler(req,res,next)).catch(next);};
}
