import { z } from 'zod';
const text = (max=120) => z.string().trim().min(1).max(max);
const decimal = z.string().regex(/^\d{1,10}([.,]\d{1,3})?$/);
export const schemas = {
 login:z.object({username:text(40),password:z.string().min(1).max(128)}),
 user:z.object({username:z.string().regex(/^[a-zA-Z0-9_.-]{3,40}$/),name:text(),password:z.string().min(12).max(128),role:z.enum(['admin','seller'])}),
 userStatus:z.object({active:z.boolean()}),
 password:z.object({password:z.string().min(12).max(128)}),
 product:z.object({name:text(),price:decimal,unit:z.enum(['unit','kg']),active:z.boolean().default(true),stock:decimal.nullable().default(null),code:z.string().trim().max(120).nullable().optional(),category:z.string().trim().max(120).optional(),brand:z.string().trim().max(120).optional(),wholesale_price:decimal.nullable().optional(),reason:z.string().trim().max(500).optional()}),
 customer:z.object({name:text(),city:text(100),identification:z.string().trim().max(80).default('')}),
 platform:z.object({name:text(80),active:z.boolean().default(true)}),
 settings:z.object({business_name:text(),paper_width:z.union([z.literal(58),z.literal(80)]),business_nit:z.string().trim().max(40).optional(),business_address:z.string().trim().max(160).optional(),business_phone:z.string().trim().max(40).optional(),business_city:z.string().trim().max(100).optional()}),
 opening:z.object({opening:decimal.default('0')}),
 sale:z.object({session_id:z.string().uuid(),customer_id:z.string().uuid(),items:z.array(z.object({product_id:z.string().uuid(),quantity:decimal,expected_price_cents:z.number().int().positive().optional()})).min(1).max(100),method:z.enum(['cash','electronic','credit']),reference:z.string().trim().max(120).optional(),route_id:z.string().uuid().nullable().optional(),platform_id:z.string().max(80).nullable().optional(),request_key:z.string().uuid(),sold_at:z.iso.datetime({offset:true}).optional(),offline_ref:z.string().trim().max(30).optional(),new_customer:z.object({id:z.string().uuid(),name:text(),city:text(100),identification:z.string().trim().max(80).default('')}).optional()}),
 closing:z.object({reviewed_revision:z.string().length(64).optional(),reviewed_sale_count:z.number().int().nonnegative().optional(),declared_cash:decimal,declared_electronic:decimal,declared_credit:decimal.default('0'),notes:z.string().trim().max(2000).default('')}),
 route:z.object({name:text(),active:z.boolean().default(true),request_key:z.string().uuid()}),
 assignment:z.object({route_id:z.string().uuid().nullable(),request_key:z.string().uuid()}),
 stock:z.object({product_id:z.string().uuid(),route_id:z.string().uuid().nullable(),quantity:decimal,kind:z.enum(['allocate','entry','adjustment']),reason:text(500),request_key:z.string().uuid()}),
 collection:z.object({customer_id:z.string().uuid(),amount:decimal,occurred_at:z.iso.datetime({offset:true}).optional(),date:z.iso.date().optional(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),method:z.enum(['cash','electronic']),platform_id:z.string().max(80).optional(),reference:z.string().trim().max(120).optional(),session_id:z.string().uuid().nullable().optional(),outside_cash_reason:text(500).optional(),observation:z.string().trim().max(2000).default(''),request_key:z.string().uuid(),allocations:z.array(z.object({sale_id:z.string().uuid(),amount:decimal})).max(100).optional()}),
 cancellation:z.object({reason:text(2000),request_key:z.string().uuid(),resolutions:z.array(z.object({allocation_id:z.string().uuid(),kind:z.enum(['refund','reassign']),target_sale_id:z.string().uuid().optional()})).max(100).optional(),refund:z.object({amount:decimal,method:z.enum(['cash','electronic']),platform_id:z.string().max(80).optional(),reference:z.string().trim().max(120).optional(),session_id:z.string().uuid().nullable().optional(),outside_cash_reason:text(500).optional()}).optional()}),
 importApply:z.object({preview_id:z.string().uuid(),request_key:z.string().uuid(),reviewed_zero_rows:z.array(z.number().int().positive()).default([])}),
 note:z.object({note:text(2000)})
};
export const validate = schema => (req,res,next)=>{
 const result=schema.safeParse(req.body);
 if (!result.success) return res.status(400).json({error:'Revisa los campos enviados.',fields:result.error.issues.map(i=>({field:i.path.join('.'),message:i.message}))});
 req.input=result.data;next();
};
