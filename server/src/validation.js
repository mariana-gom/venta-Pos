import { z } from 'zod';
const text = (max=120) => z.string().trim().min(1).max(max);
const decimal = z.string().regex(/^\d{1,10}([.,]\d{1,3})?$/);
export const schemas = {
 login:z.object({username:text(40),password:z.string().min(1).max(128)}),
 user:z.object({username:z.string().regex(/^[a-zA-Z0-9_.-]{3,40}$/),name:text(),password:z.string().min(12).max(128),role:z.enum(['admin','seller'])}),
 userStatus:z.object({active:z.boolean()}),
 password:z.object({password:z.string().min(12).max(128)}),
 product:z.object({name:text(),price:decimal,unit:z.enum(['unit','kg']),active:z.boolean().default(true),stock:decimal.nullable().default(null)}),
 customer:z.object({name:text(),city:text(100)}),
 platform:z.object({name:text(80),active:z.boolean().default(true)}),
 settings:z.object({business_name:text(),paper_width:z.union([z.literal(58),z.literal(80)])}),
 opening:z.object({opening:decimal.default('0')}),
 sale:z.object({session_id:z.string().uuid(),customer_id:z.string().uuid(),items:z.array(z.object({product_id:z.string().uuid(),quantity:decimal,expected_price_cents:z.number().int().positive().optional()})).min(1).max(100),method:z.enum(['cash','electronic']),platform_id:z.string().max(80).nullable().optional(),request_key:z.string().uuid()}),
 closing:z.object({reviewed_sale_count:z.number().int().nonnegative().optional(),declared_cash:decimal,declared_electronic:decimal,notes:z.string().trim().max(2000).default('')}),
 note:z.object({note:text(2000)})
};
export const validate = schema => (req,res,next)=>{
 const result=schema.safeParse(req.body);
 if (!result.success) return res.status(400).json({error:'Revisa los campos enviados.',fields:result.error.issues.map(i=>({field:i.path.join('.'),message:i.message}))});
 req.input=result.data;next();
};
