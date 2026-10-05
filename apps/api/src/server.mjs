import express from "express";
import cors from "cors";
import helmet from "helmet";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import pg from "pg";
import multer from "multer";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const app=express();
app.use(helmet());
const allowedOrigin=process.env.WEB_ORIGIN||true;
app.use(cors({origin:allowedOrigin,credentials:false}));
app.use(express.json({limit:"2mb",verify:(req,_res,buf)=>{req.rawBody=Buffer.from(buf);}}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024}});
const PORT=process.env.PORT||4000;
const JWT_SECRET=process.env.JWT_SECRET||"CHANGE_THIS_IN_PRODUCTION";
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes("render.com")?{rejectUnauthorized:false}:undefined}):null;
const demo={properties:[],media:[],leads:[],aiJobs:[],renders:[],campaigns:[]};
const id=()=>crypto.randomUUID();

const r2Config={
  accountId:process.env.R2_ACCOUNT_ID||"",
  accessKeyId:process.env.R2_ACCESS_KEY_ID||"",
  secretAccessKey:process.env.R2_SECRET_ACCESS_KEY||"",
  bucket:process.env.R2_BUCKET_NAME||""
};
const r2Ready=()=>Boolean(r2Config.accountId&&r2Config.accessKeyId&&r2Config.secretAccessKey&&r2Config.bucket);
const r2Client=r2Ready()?new S3Client({region:"auto",endpoint:`https://${r2Config.accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId:r2Config.accessKeyId,secretAccessKey:r2Config.secretAccessKey}}):null;
const safeFileName=(name)=>String(name||"file").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"file";

async function migrateAndSeed(){
  if(!pool)return;
  await pool.query(`create table if not exists campaigns (
    id uuid primary key,
    workspace_id uuid not null,
    owner_id uuid,
    name text not null,
    property_id uuid,
    platform text default 'Meta',
    objective text default 'WhatsApp Leads',
    funnel text default 'Cold → Warm → Hot',
    daily_budget numeric default 0,
    start_date date,
    end_date date,
    creative_ids jsonb not null default '[]'::jsonb,
    notes text default '',
    status text default 'draft',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`);

  const sql=await fs.readFile(path.resolve(process.cwd(),"migration.sql"),"utf8").catch(()=>null);
  if(sql) await pool.query(sql);
  const email=process.env.DEMO_ADMIN_EMAIL||"admin@sce.local";
  const password=process.env.DEMO_ADMIN_PASSWORD||"demo123";
  let ws=(await pool.query("select id from workspaces where name=$1 limit 1",["AZM1 Property Workspace"])).rows[0];
  if(!ws){ws=(await pool.query("insert into workspaces(name,plan) values($1,$2) returning id",["AZM1 Property Workspace","starter"])).rows[0];}
  let user=(await pool.query("select id,workspace_id,role,email from users where email=$1",[email])).rows[0];
  const hash=await bcrypt.hash(password,10);
  if(!user){
    user=(await pool.query("insert into users(workspace_id,full_name,email,password_hash,role) values($1,$2,$3,$4,$5) returning id,workspace_id,role,email",[ws.id,"Ismail bin Ibrahim",email,hash,"admin"])).rows[0];
  } else {
    await pool.query("update users set password_hash=$1, status='active' where id=$2",[hash,user.id]);
  }
  const count=(await pool.query("select count(*)::int as n from properties where workspace_id=$1",[ws.id])).rows[0].n;
  if(count===0){
    const p=(await pool.query(`insert into properties(workspace_id,owner_id,name,location,price,tenure,bedrooms,bathrooms,built_up,lot_type,verified_usps) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,[ws.id,user.id,"Double Storey Terrace","Pasir Gudang Johor",850000,"Leasehold",4,3,"2,024 sqft","24 x 60",JSON.stringify(["4 bedrooms","3 bathrooms","2,024 sqft","Leasehold"])] )).rows[0];
    const leadCount=(await pool.query("select count(*)::int as n from leads where workspace_id=$1",[ws.id])).rows[0].n;
    if(leadCount===0) await pool.query("insert into leads(workspace_id,property_id,owner_id,name,phone,stage,source) values($1,$2,$3,$4,$5,$6,$7)",[ws.id,p.id,user.id,"Ahmad","012-3456789","new","Demo"]);
  }
}

function auth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer "))return res.status(401).json({error:"Unauthorized"});
  try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next();}catch{res.status(401).json({error:"Invalid token"});}
}

app.get("/health",async(_,res)=>{let db=false;if(pool){try{await pool.query("select 1");db=true;}catch{}}res.json({ok:true,version:"V9.2",db,r2:r2Ready(),lead_integration:Boolean(LEAD_WEBHOOK_SECRET&&LEAD_WEBHOOK_WORKSPACE_ID&&db),meta_webhook:Boolean(META_VERIFY_TOKEN&&META_APP_SECRET&&META_PAGE_ACCESS_TOKEN&&db),tiktok_webhook:Boolean(TIKTOK_CLIENT_KEY&&TIKTOK_CLIENT_SECRET&&LEAD_WEBHOOK_WORKSPACE_ID&&db)});});

app.post("/api/auth/login",async(req,res)=>{
  const {email,password}=req.body||{};
  if(pool){
    const r=await pool.query("select id,workspace_id,full_name,email,password_hash,role,status from users where email=$1 limit 1",[email]);
    const u=r.rows[0];
    if(u&&u.status==="active"&&u.password_hash&&await bcrypt.compare(password,u.password_hash)){
      const token=jwt.sign({sub:u.id,workspace_id:u.workspace_id,role:u.role,email:u.email},JWT_SECRET,{expiresIn:"8h"});
      return res.json({token,user:{id:u.id,name:u.full_name,email:u.email,role:u.role,workspace_id:u.workspace_id}});
    }
  }
  if(!pool&&email===(process.env.DEMO_ADMIN_EMAIL||"admin@sce.local")&&password===(process.env.DEMO_ADMIN_PASSWORD||"demo123")){
    const token=jwt.sign({sub:"demo-admin",workspace_id:"demo-workspace",role:"admin",email},JWT_SECRET,{expiresIn:"8h"});
    return res.json({token,user:{id:"demo-admin",name:"Ismail bin Ibrahim",email,role:"admin",workspace_id:"demo-workspace"}});
  }
  res.status(401).json({error:"Invalid credentials"});
});

const propertySchema=z.object({name:z.string().min(1),location:z.string().optional(),price:z.number().nullable().optional(),tenure:z.string().optional(),bedrooms:z.number().int().nonnegative().optional(),bathrooms:z.number().int().nonnegative().optional(),built_up:z.string().optional(),lot_type:z.string().optional(),verified_usps:z.array(z.string()).default([])});
app.get("/api/properties",auth,async(req,res)=>{if(pool){const r=await pool.query("select * from properties where workspace_id=$1 order by created_at desc",[req.user.workspace_id]);return res.json(r.rows);}res.json(demo.properties.filter(x=>x.workspace_id===req.user.workspace_id));});
app.post("/api/properties",auth,async(req,res)=>{const parsed=propertySchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.flatten()});if(pool){const dup=await pool.query("select id from properties where workspace_id=$1 and lower(name)=lower($2) and lower(coalesce(location,''))=lower(coalesce($3,'')) limit 1",[req.user.workspace_id,parsed.data.name,parsed.data.location||""]);if(dup.rowCount)return res.status(409).json({error:"Property dengan nama dan lokasi yang sama sudah wujud",id:dup.rows[0].id});}
const p={id:id(),workspace_id:req.user.workspace_id,owner_id:req.user.sub,...parsed.data};if(pool){const r=await pool.query(`insert into properties(id,workspace_id,owner_id,name,location,price,tenure,bedrooms,bathrooms,built_up,lot_type,verified_usps) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[p.id,p.workspace_id,p.owner_id,p.name,p.location,p.price,p.tenure,p.bedrooms,p.bathrooms,p.built_up,p.lot_type,JSON.stringify(p.verified_usps)]);return res.status(201).json(r.rows[0]);}demo.properties.unshift(p);res.status(201).json(p);});
app.patch("/api/properties/:id",auth,async(req,res)=>{
  const parsed=propertySchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:parsed.error.flatten()});
  const idv=req.params.id;
  if(pool){
    const dup=await pool.query("select id from properties where workspace_id=$1 and lower(name)=lower($2) and lower(coalesce(location,''))=lower(coalesce($3,'')) and id<>$4 limit 1",[req.user.workspace_id,parsed.data.name,parsed.data.location||"",idv]);
    if(dup.rowCount)return res.status(409).json({error:"Property dengan nama dan lokasi yang sama sudah wujud",id:dup.rows[0].id});
    const r=await pool.query(`update properties set name=$1,location=$2,price=$3,tenure=$4,bedrooms=$5,bathrooms=$6,built_up=$7,lot_type=$8,verified_usps=$9,updated_at=now() where id=$10 and workspace_id=$11 returning *`,[parsed.data.name,parsed.data.location||"",parsed.data.price??null,parsed.data.tenure||"",parsed.data.bedrooms??0,parsed.data.bathrooms??0,parsed.data.built_up||"",parsed.data.lot_type||"",JSON.stringify(parsed.data.verified_usps||[]),idv,req.user.workspace_id]);
    if(!r.rowCount)return res.status(404).json({error:"Property tidak dijumpai"});
    return res.json(r.rows[0]);
  }
  const p=demo.properties.find(x=>x.id===idv&&x.workspace_id===req.user.workspace_id);
  if(!p)return res.status(404).json({error:"Property tidak dijumpai"});
  Object.assign(p,parsed.data);return res.json(p);
});
app.delete("/api/properties/:id",auth,async(req,res)=>{
  const idv=req.params.id;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idv)){
    return res.status(400).json({error:"ID property tidak sah. Sila refresh data property dan cuba lagi."});
  }
  if(pool){
    const r=await pool.query("delete from properties where id=$1 and workspace_id=$2 returning id",[idv,req.user.workspace_id]);
    if(!r.rowCount)return res.status(404).json({error:"Property tidak dijumpai"});
    return res.json({ok:true,id:idv});
  }
  const i=demo.properties.findIndex(x=>x.id===idv&&x.workspace_id===req.user.workspace_id);
  if(i<0)return res.status(404).json({error:"Property tidak dijumpai"});
  demo.properties.splice(i,1);return res.json({ok:true,id:idv});
});

app.get("/api/leads",auth,async(req,res)=>{if(pool){const r=await pool.query("select * from leads where workspace_id=$1 order by created_at desc",[req.user.workspace_id]);return res.json(r.rows);}res.json(demo.leads.filter(x=>x.workspace_id===req.user.workspace_id));});
app.post("/api/leads",auth,async(req,res)=>{const l={id:id(),workspace_id:req.user.workspace_id,owner_id:req.user.sub,stage:"new",...req.body};if(pool){const r=await pool.query(`insert into leads(id,workspace_id,property_id,owner_id,name,phone,email,stage,source,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[l.id,l.workspace_id,l.property_id,l.owner_id,l.name,l.phone,l.email,l.stage,l.source,l.notes]);return res.status(201).json(r.rows[0]);}demo.leads.unshift(l);res.status(201).json(l);});
app.patch("/api/leads/:id",auth,async(req,res)=>{if(pool){const r=await pool.query("update leads set stage=coalesce($1,stage),notes=coalesce($2,notes),updated_at=now() where id=$3 and workspace_id=$4 returning *",[req.body.stage,req.body.notes,req.params.id,req.user.workspace_id]);return r.rowCount?res.json(r.rows[0]):res.sendStatus(404);}const l=demo.leads.find(x=>x.id===req.params.id&&x.workspace_id===req.user.workspace_id);if(!l)return res.sendStatus(404);Object.assign(l,req.body);res.json(l);});

app.get("/api/media",auth,async(req,res)=>{const propertyId=req.query.property_id?String(req.query.property_id):null;if(pool){const r=propertyId?await pool.query("select * from media where workspace_id=$1 and property_id=$2 order by created_at desc",[req.user.workspace_id,propertyId]):await pool.query("select * from media where workspace_id=$1 order by created_at desc",[req.user.workspace_id]);return res.json(r.rows);}res.json(demo.media.filter(x=>x.workspace_id===req.user.workspace_id&&(!propertyId||String(x.property_id)===propertyId)));});
app.post("/api/media/complete",auth,async(req,res)=>{const m={id:id(),workspace_id:req.user.workspace_id,...req.body};if(pool){const r=await pool.query(`insert into media(id,workspace_id,property_id,storage_key,original_name,mime_type,size_bytes,tag) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[m.id,m.workspace_id,m.property_id,m.storage_key,m.original_name,m.mime_type,m.size_bytes,m.tag]);return res.status(201).json(r.rows[0]);}demo.media.unshift(m);res.status(201).json(m);});

app.get("/api/media/:id/file",auth,async(req,res)=>{
  if(!r2Ready()) return res.status(503).json({error:"R2 object storage belum dikonfigurasi di API"});
  if(!pool) return res.status(503).json({error:"Media file memerlukan database production"});
  const r=await pool.query("select storage_key,original_name,mime_type from media where id=$1 and workspace_id=$2 limit 1",[req.params.id,req.user.workspace_id]);
  if(!r.rowCount)return res.status(404).json({error:"Media tidak dijumpai"});
  try{
    const obj=await r2Client.send(new GetObjectCommand({Bucket:r2Config.bucket,Key:r.rows[0].storage_key}));
    res.setHeader("Content-Type",r.rows[0].mime_type||obj.ContentType||"application/octet-stream");
    res.setHeader("Content-Disposition",`inline; filename="${safeFileName(r.rows[0].original_name||"media")}"`);
    if(obj.ContentLength!=null)res.setHeader("Content-Length",String(obj.ContentLength));
    obj.Body.pipe(res);
  }catch(err){console.error("R2 media file failed",err);return res.status(502).json({error:"Gagal mendapatkan fail media",detail:err?.message||"Unknown error"});}
});

app.get("/api/media/:id/url",auth,async(req,res)=>{
  if(!r2Ready()) return res.status(503).json({error:"R2 object storage belum dikonfigurasi di API"});
  if(!pool) return res.status(503).json({error:"Media URL memerlukan database production"});
  const r=await pool.query("select id,storage_key,original_name,mime_type from media where id=$1 and workspace_id=$2 limit 1",[req.params.id,req.user.workspace_id]);
  if(!r.rowCount)return res.status(404).json({error:"Media tidak dijumpai"});
  try{
    const url=await getSignedUrl(r2Client,new GetObjectCommand({Bucket:r2Config.bucket,Key:r.rows[0].storage_key}),{expiresIn:900});
    return res.json({id:r.rows[0].id,url,expires_in:900,original_name:r.rows[0].original_name,mime_type:r.rows[0].mime_type});
  }catch(err){
    console.error("R2 signed URL failed",err);
    return res.status(502).json({error:"Gagal mendapatkan URL media",detail:err?.message||"Unknown error"});
  }
});

app.post("/api/media/upload",auth,upload.single("file"),async(req,res)=>{
  if(!r2Ready()) return res.status(503).json({error:"R2 object storage belum dikonfigurasi di API"});
  if(!req.file) return res.status(400).json({error:"Sila pilih fail gambar"});
  if(!String(req.file.mimetype||"").startsWith("image/")) return res.status(400).json({error:"Hanya fail gambar dibenarkan"});
  const propertyId=req.body.property_id||null;
  const tag=String(req.body.tag||"hero").toLowerCase();
  if(pool){
    const dup=await pool.query(`select id,original_name from media where workspace_id=$1 and property_id is not distinct from $2 and lower(coalesce(tag,'hero'))=$3 and original_name=$4 and size_bytes=$5 limit 1`,[req.user.workspace_id,propertyId,tag,req.file.originalname,req.file.size]);
    if(dup.rows[0]) return res.status(409).json({error:"Media duplicate: gambar yang sama sudah wujud untuk property dan tag ini",media_id:dup.rows[0].id});
  }else{
    const dup=demo.media.find(x=>x.workspace_id===req.user.workspace_id&&String(x.property_id||"")===String(propertyId||"")&&String(x.tag||"hero").toLowerCase()===tag&&x.original_name===req.file.originalname&&Number(x.size_bytes||0)===Number(req.file.size||0));
    if(dup) return res.status(409).json({error:"Media duplicate: gambar yang sama sudah wujud untuk property dan tag ini",media_id:dup.id});
  }
  const mediaId=id();
  const key=`media/${req.user.workspace_id}/${mediaId}-${safeFileName(req.file.originalname)}`;
  try{
    await r2Client.send(new PutObjectCommand({Bucket:r2Config.bucket,Key:key,Body:req.file.buffer,ContentType:req.file.mimetype,Metadata:{originalname:String(req.file.originalname||"")}}));
    const m={id:mediaId,workspace_id:req.user.workspace_id,property_id:propertyId,storage_key:key,original_name:req.file.originalname,mime_type:req.file.mimetype,size_bytes:req.file.size,tag};
    if(pool){
      const r=await pool.query(`insert into media(id,workspace_id,property_id,storage_key,original_name,mime_type,size_bytes,tag) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[m.id,m.workspace_id,m.property_id,m.storage_key,m.original_name,m.mime_type,m.size_bytes,m.tag]);
      return res.status(201).json(r.rows[0]);
    }
    demo.media.unshift(m);
    return res.status(201).json(m);
  }catch(err){
    try{await r2Client.send(new DeleteObjectCommand({Bucket:r2Config.bucket,Key:key}));}catch{}
    console.error("R2 upload failed",err);
    return res.status(502).json({error:"Upload ke Cloudflare R2 gagal",detail:err?.message||"Unknown error"});
  }
});

function factLockedOutput(property,funnel,audience,angle){
  const verified=(property.verified_usps||[]).filter(Boolean).map(x=>String(x).trim()).filter(Boolean);
  const normalizeBuiltUp=(value)=>{
    const raw=String(value??"").trim();
    if(!raw||raw==="-") return "";
    if(/sq\.?\s*ft|sqft|kaki\s*persegi/i.test(raw)) return raw;
    if(/^\d[\d,]*(?:\.\d+)?$/.test(raw)) return `${raw} sqft`;
    return raw;
  };
  const builtUp=normalizeBuiltUp(property.built_up);
  const coreFacts=[];
  if(property.bedrooms!=null) coreFacts.push(`${property.bedrooms} bilik`);
  if(property.bathrooms!=null) coreFacts.push(`${property.bathrooms} bilik air`);
  if(builtUp) coreFacts.push(builtUp);
  if(property.tenure) coreFacts.push(String(property.tenure).trim());
  if(property.lot_type) coreFacts.push(`Lot/Tanah: ${String(property.lot_type).trim()}`);
  const allFacts=[...coreFacts,...verified];
  const facts=[...new Set(allFacts)];
  const factLine=facts.length?facts.join(" • "):"Maklumat property belum lengkap.";
  const location=String(property.location||"").trim();
  const headline=funnel==="Cold"
    ?`Kenali ${property.name}${location?` di ${location}`:""}`
    :funnel==="Warm"
      ?`Semak fakta ${property.name} sebelum buat keputusan`
      :`Jom semak viewing ${property.name}`;
  const price=property.price!=null?`RM ${Number(property.price).toLocaleString("en-MY")}`:"Hubungi untuk harga";
  const primary=[
    `${property.name}${location?` di ${location}`:""}.`,
    factLine,
    `Harga: ${price}.`,
    "Untuk detail penuh dan info viewing, WhatsApp sekarang."
  ].join("\n");
  return {
    language:"ms-MY",
    headline,
    hook:`${headline}.`,
    primary_text:primary,
    cta:"WhatsApp untuk detail & viewing",
    whatsapp:`Assalamualaikum, saya berminat dengan ${property.name}. Boleh saya dapatkan detail dan info viewing?`,
    video_30s:{scene_1:"Hook property",scene_2:"Paparkan fakta yang disahkan",scene_3:"CTA WhatsApp"},
    funnel,audience,angle,
    facts,
    fact_check:{status:"PASS",used_verified_facts:facts,generated_claims:[]}
  };
}
app.post("/api/ai/jobs",auth,async(req,res)=>{const {property,funnel="Cold",audience="Pembeli rumah",angle="Property Showcase"}=req.body||{};if(!property?.name)return res.status(400).json({error:"property required"});const output=factLockedOutput(property,funnel,audience,angle);const job={id:id(),workspace_id:req.user.workspace_id,owner_id:req.user.sub,property_id:property.id||null,status:"completed",output};if(pool){const r=await pool.query(`insert into ai_jobs(id,workspace_id,owner_id,property_id,funnel_stage,request,response,provider,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[job.id,job.workspace_id,job.owner_id,job.property_id,funnel,JSON.stringify(req.body),JSON.stringify(output),process.env.AI_PROVIDER||"demo","completed"]);return res.status(201).json(r.rows[0]);}demo.aiJobs.unshift(job);res.status(201).json(job);});

app.get("/api/ai/jobs",auth,async(req,res)=>{if(pool){const r=await pool.query("select * from ai_jobs where workspace_id=$1 order by created_at desc",[req.user.workspace_id]);return res.json(r.rows);}res.json(demo.aiJobs.filter(x=>x.workspace_id===req.user.workspace_id));});
app.post("/api/creative/renders",auth,async(req,res)=>{const render={id:id(),workspace_id:req.user.workspace_id,owner_id:req.user.sub,status:"draft",...req.body};if(pool){const r=await pool.query(`insert into creative_renders(id,workspace_id,owner_id,property_id,format,brief,status) values($1,$2,$3,$4,$5,$6,$7) returning *`,[render.id,render.workspace_id,render.owner_id,render.property_id,render.format,JSON.stringify(render.brief||{}),"draft"]);return res.status(201).json(r.rows[0]);}demo.renders.unshift(render);res.status(201).json(render);});
const campaignSchema=z.object({name:z.string().min(1),property_id:z.string().uuid().nullable().optional(),platform:z.string().optional(),objective:z.string().optional(),funnel:z.string().optional(),daily_budget:z.number().nonnegative().optional(),start_date:z.string().nullable().optional(),end_date:z.string().nullable().optional(),creative_ids:z.array(z.string()).default([]),notes:z.string().optional(),status:z.enum(["draft","ready","running","paused","completed"]).default("draft")});
app.get("/api/campaigns",auth,async(req,res)=>{
  if(pool){const r=await pool.query("select * from campaigns where workspace_id=$1 order by created_at desc",[req.user.workspace_id]);return res.json(r.rows)}
  res.json((demo.campaigns||[]).filter(x=>x.workspace_id===req.user.workspace_id));
});
app.post("/api/campaigns",auth,async(req,res)=>{
  const parsed=campaignSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.flatten()});
  const c={id:id(),workspace_id:req.user.workspace_id,owner_id:req.user.sub,...parsed.data};
  if(pool){const r=await pool.query(`insert into campaigns(id,workspace_id,owner_id,name,property_id,platform,objective,funnel,daily_budget,start_date,end_date,creative_ids,notes,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,[c.id,c.workspace_id,c.owner_id,c.name,c.property_id||null,c.platform||"Meta",c.objective||"WhatsApp Leads",c.funnel||"Cold → Warm → Hot",c.daily_budget||0,c.start_date||null,c.end_date||null,JSON.stringify(c.creative_ids||[]),c.notes||"",c.status||"draft"]);return res.status(201).json(r.rows[0])}
  demo.campaigns=demo.campaigns||[];demo.campaigns.unshift(c);return res.status(201).json(c);
});
app.patch("/api/campaigns/:id",auth,async(req,res)=>{
  const status=req.body?.status?String(req.body.status):null;
  if(pool){const r=await pool.query("update campaigns set status=coalesce($1,status),updated_at=now() where id=$2 and workspace_id=$3 returning *",[status,req.params.id,req.user.workspace_id]);return r.rowCount?res.json(r.rows[0]):res.sendStatus(404)}
  const c=(demo.campaigns||[]).find(x=>x.id===req.params.id&&x.workspace_id===req.user.workspace_id);if(!c)return res.sendStatus(404);if(status)c.status=status;res.json(c);
});

app.get("/api/creative/renders",auth,async(req,res)=>{if(pool){const r=await pool.query("select * from creative_renders where workspace_id=$1 order by created_at desc",[req.user.workspace_id]);return res.json(r.rows);}res.json(demo.renders.filter(x=>x.workspace_id===req.user.workspace_id).sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||""))));});
app.patch("/api/creative/renders/:id",auth,async(req,res)=>{const status=req.body?.status?String(req.body.status):null;if(pool){const r=await pool.query("update creative_renders set status=coalesce($1,status),brief=coalesce($2,brief) where id=$3 and workspace_id=$4 returning *",[status,req.body?.brief?JSON.stringify(req.body.brief):null,req.params.id,req.user.workspace_id]);return r.rowCount?res.json(r.rows[0]):res.sendStatus(404);}const x=demo.renders.find(a=>a.id===req.params.id&&a.workspace_id===req.user.workspace_id);if(!x)return res.sendStatus(404);if(status)x.status=status;if(req.body?.brief)x.brief=req.body.brief;res.json(x);});




const LEAD_WEBHOOK_SECRET=String(process.env.LEAD_WEBHOOK_SECRET||"");
const LEAD_WEBHOOK_WORKSPACE_ID=String(process.env.LEAD_WEBHOOK_WORKSPACE_ID||"");

async function ensureLeadIngestionTable(){
  if(!pool)return;
  await pool.query(`create table if not exists lead_ingestion_events(
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    provider text not null,
    external_id text not null,
    lead_id uuid references leads(id) on delete set null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique(workspace_id,provider,external_id)
  )`);
  await pool.query("create index if not exists lead_ingestion_provider_idx on lead_ingestion_events(workspace_id,provider,created_at desc)");
}

function webhookAuthorized(req){
  if(!LEAD_WEBHOOK_SECRET)return false;
  const supplied=String(req.headers["x-sce-webhook-secret"]||"");
  const a=Buffer.from(supplied),b=Buffer.from(LEAD_WEBHOOK_SECRET);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

function normalizeInboundLead(body,provider){
  const b=body&&typeof body==="object"?body:{};
  const fields=b.fields&&typeof b.fields==="object"?b.fields:{};
  const data=b.data&&typeof b.data==="object"?b.data:{};
  const source=b.source||`\${provider}_lead`;
  return {
    external_id:String(b.external_id||b.lead_id||b.id||data.external_id||data.lead_id||data.id||"").trim(),
    name:String(b.name||b.full_name||fields.name||fields.full_name||data.name||"").trim().slice(0,200),
    phone:String(b.phone||b.whatsapp||fields.phone||fields.whatsapp||data.phone||data.whatsapp||"").trim().slice(0,80),
    email:String(b.email||fields.email||data.email||"").trim().slice(0,200),
    property_id:b.property_id||null,
    campaign_id:b.campaign_id||null,
    creative_id:b.creative_id||null,
    funnel_stage:String(b.funnel_stage||"Cold").slice(0,80),
    source:String(source).slice(0,100),
    notes:String(b.notes||"").trim().slice(0,2000)
  };
}

app.get("/api/integrations/diagnostics",auth,async(req,res)=>{
  const db=Boolean(pool);let dbOk=false;
  if(pool){try{await pool.query("select 1");dbOk=true;}catch{}}
  const workspaceId=String(req.user.workspace_id||"");
  const webhookWorkspace=String(LEAD_WEBHOOK_WORKSPACE_ID||"");
  const workspaceMatch=Boolean(workspaceId&&webhookWorkspace&&workspaceId===webhookWorkspace);
  const checks=[
    {key:"database",label:"PostgreSQL",ok:dbOk},
    {key:"workspace",label:"Webhook workspace mapping",ok:workspaceMatch},
    {key:"normalized_secret",label:"Normalized webhook secret",ok:Boolean(LEAD_WEBHOOK_SECRET)},
    {key:"meta",label:"Meta webhook credentials",ok:Boolean(META_VERIFY_TOKEN&&META_APP_SECRET&&META_PAGE_ACCESS_TOKEN)},
    {key:"tiktok",label:"TikTok webhook credentials",ok:Boolean(TIKTOK_CLIENT_KEY&&TIKTOK_CLIENT_SECRET)}
  ];
  res.json({ok:checks.every(x=>x.ok),version:"V9.2",workspace_id:workspaceId,checks,endpoints:{meta:"/webhooks/meta",tiktok:"/webhooks/tiktok",normalized:"/api/integrations/leads/{meta|tiktok}"},next_steps:[...(!dbOk?["DATABASE_URL / PostgreSQL belum READY"]:[]),...(!workspaceMatch?["LEAD_WEBHOOK_WORKSPACE_ID belum sepadan dengan workspace"]:[]),...(!Boolean(TIKTOK_CLIENT_KEY&&TIKTOK_CLIENT_SECRET)?["Masukkan TikTok client key/secret di Render"]:[]),...(!Boolean(META_VERIFY_TOKEN&&META_APP_SECRET&&META_PAGE_ACCESS_TOKEN)?["Lengkapkan Meta webhook credentials di Render"]:[])]});
});

app.get("/api/integrations/status",auth,async(req,res)=>{
  let workspaceOk=Boolean(LEAD_WEBHOOK_WORKSPACE_ID&&LEAD_WEBHOOK_WORKSPACE_ID===String(req.user.workspace_id));
  let secretOk=Boolean(LEAD_WEBHOOK_SECRET);
  let dbOk=Boolean(pool);
  res.json({
    ok:true,
    version:"V9.1",
    workspace_id:String(req.user.workspace_id),
    database:dbOk,
    normalizedLeadWebhook:workspaceOk&&secretOk&&dbOk,
    meta:{configured:workspaceOk&&secretOk&&dbOk&&Boolean(META_VERIFY_TOKEN&&META_APP_SECRET&&META_PAGE_ACCESS_TOKEN),mode:"meta_lead_ads_webhook"},
    tiktok:{configured:workspaceOk&&secretOk&&dbOk&&Boolean(TIKTOK_CLIENT_KEY&&TIKTOK_CLIENT_SECRET),mode:"tiktok_webhook"},
    endpoint:workspaceOk&&secretOk?"/api/integrations/leads/{meta|tiktok}":null,
    requirements:["LEAD_WEBHOOK_SECRET","LEAD_WEBHOOK_WORKSPACE_ID","DATABASE_URL","META_VERIFY_TOKEN","META_APP_SECRET","META_PAGE_ACCESS_TOKEN","TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET"]
  });
});

async function ingestNormalizedLead(provider,normalized,payload){
  const workspaceId=LEAD_WEBHOOK_WORKSPACE_ID;
  if(!pool||!workspaceId)throw Object.assign(new Error("Lead webhook belum dikonfigurasi di backend"),{status:503});
  if(!normalized.external_id)throw Object.assign(new Error("external_id/lead_id/id diperlukan untuk deduplication"),{status:400});
  if(!normalized.name&&!normalized.phone&&!normalized.email)throw Object.assign(new Error("Sekurang-kurangnya name, phone atau email diperlukan"),{status:400});
  const ws=await pool.query("select id from workspaces where id=$1 limit 1",[workspaceId]);
  if(!ws.rowCount)throw Object.assign(new Error("LEAD_WEBHOOK_WORKSPACE_ID tidak sepadan dengan workspace production"),{status:500});
  const existing=await pool.query("select id,lead_id from lead_ingestion_events where workspace_id=$1 and provider=$2 and external_id=$3 limit 1",[workspaceId,provider,normalized.external_id]);
  if(existing.rowCount)return {ok:true,duplicate:true,lead_id:existing.rows[0].lead_id,event_id:existing.rows[0].id};
  const validProperty=normalized.property_id?await pool.query("select id from properties where id=$1 and workspace_id=$2 limit 1",[normalized.property_id,workspaceId]):{rowCount:0};
  const propertyId=validProperty.rowCount?normalized.property_id:null;
  const validCampaign=normalized.campaign_id?await pool.query("select id from campaigns where id=$1 and workspace_id=$2 limit 1",[normalized.campaign_id,workspaceId]):{rowCount:0};
  const campaignId=validCampaign.rowCount?normalized.campaign_id:null;
  const validCreative=normalized.creative_id?await pool.query("select id from creative_renders where id=$1 and workspace_id=$2 limit 1",[normalized.creative_id,workspaceId]):{rowCount:0};
  const creativeId=validCreative.rowCount?normalized.creative_id:null;
  const leadId=id(),client=await pool.connect();
  try{
    await client.query("begin");
    const lead=await client.query(`insert into leads(id,workspace_id,property_id,owner_id,name,phone,email,stage,source,notes,campaign_id,creative_id,funnel_stage)
      values($1,$2,$3,(select id from users where workspace_id=$2 and role='admin' order by created_at asc limit 1),$4,$5,$6,'new',$7,$8,$9,$10,$11) returning id,name,phone,email,stage,source,property_id,campaign_id,creative_id,funnel_stage,created_at`,
      [leadId,workspaceId,propertyId,normalized.name||"Lead",normalized.phone||null,normalized.email||null,normalized.source,normalized.notes,campaignId,creativeId,normalized.funnel_stage]);
    const event=await client.query("insert into lead_ingestion_events(workspace_id,provider,external_id,lead_id,payload) values($1,$2,$3,$4,$5) returning id",[workspaceId,provider,normalized.external_id,leadId,JSON.stringify(payload||{})]);
    await client.query("commit");
    return {ok:true,duplicate:false,provider,lead:lead.rows[0],event_id:event.rows[0].id};
  }catch(err){
    await client.query("rollback");
    if(String(err?.code)==="23505"){
      const dup=await pool.query("select id,lead_id from lead_ingestion_events where workspace_id=$1 and provider=$2 and external_id=$3 limit 1",[workspaceId,provider,normalized.external_id]);
      if(dup.rowCount)return {ok:true,duplicate:true,lead_id:dup.rows[0].lead_id,event_id:dup.rows[0].id};
    }
    throw err;
  }finally{client.release();}
}

app.post("/api/integrations/leads/:provider",async(req,res)=>{
  const provider=String(req.params.provider||"").toLowerCase();
  if(!["meta","tiktok"].includes(provider))return res.status(404).json({error:"Provider tidak disokong"});
  if(!webhookAuthorized(req))return res.status(401).json({error:"Webhook tidak sah atau secret belum dikonfigurasi"});
  try{return res.status(201).json(await ingestNormalizedLead(provider,normalizeInboundLead(req.body,provider),req.body||{}));}
  catch(err){console.error("Lead ingestion failed",err);return res.status(err?.status||500).json({error:err?.message||"Gagal menyimpan lead integration"});}
}

const META_VERIFY_TOKEN=String(process.env.META_VERIFY_TOKEN||"");
const META_APP_SECRET=String(process.env.META_APP_SECRET||"");
const META_PAGE_ACCESS_TOKEN=String(process.env.META_PAGE_ACCESS_TOKEN||"");
const META_GRAPH_VERSION=String(process.env.META_GRAPH_VERSION||"v24.0");
const TIKTOK_CLIENT_KEY=String(process.env.TIKTOK_CLIENT_KEY||"");
const TIKTOK_CLIENT_SECRET=String(process.env.TIKTOK_CLIENT_SECRET||"");
const TIKTOK_SIGNATURE_MAX_AGE_SECONDS=Math.max(60,Number(process.env.TIKTOK_SIGNATURE_MAX_AGE_SECONDS||300));

function metaSignatureValid(req){
  if(!META_APP_SECRET)return false;
  const signature=String(req.headers["x-hub-signature-256"]||"");
  if(!signature.startsWith("sha256="))return false;
  const raw=Buffer.isBuffer(req.rawBody)?req.rawBody:Buffer.from(JSON.stringify(req.body||{}));
  const expected="sha256="+crypto.createHmac("sha256",META_APP_SECRET).update(raw).digest("hex");
  const a=Buffer.from(signature),b=Buffer.from(expected);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

function metaFieldMap(fieldData){
  const out={};
  for(const item of Array.isArray(fieldData)?fieldData:[]){
    const key=String(item?.name||"").trim().toLowerCase(),values=Array.isArray(item?.values)?item.values:[];
    if(key)out[key]=values.length>1?values.join(", "):String(values[0]??"").trim();
  }
  return out;
}

async function fetchMetaLead(leadgenId){
  if(!META_PAGE_ACCESS_TOKEN)throw Object.assign(new Error("META_PAGE_ACCESS_TOKEN belum dikonfigurasi"),{status:503});
  const url=`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(leadgenId)}?fields=id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,page_id&access_token=${encodeURIComponent(META_PAGE_ACCESS_TOKEN)}`;
  const r=await fetch(url);
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(j?.error?.message||"Meta Graph API gagal mendapatkan lead"),{status:502});
  return j;
}

app.get("/webhooks/meta",async(req,res)=>{
  const mode=String(req.query["hub.mode"]||"");
  const token=String(req.query["hub.verify_token"]||"");
  const challenge=String(req.query["hub.challenge"]||"");
  if(mode==="subscribe"&&META_VERIFY_TOKEN&&token===META_VERIFY_TOKEN)return res.status(200).send(challenge);
  return res.sendStatus(403);
});

function tiktokSignatureValid(req){
  if(!TIKTOK_CLIENT_SECRET)return false;
  const header=String(req.headers["tiktok-signature"]||"");
  const parts={};
  for(const item of header.split(",")){const [k,...rest]=item.trim().split("=");if(k&&rest.length)parts[k]=rest.join("=");}
  const timestamp=String(parts.t||"").trim(),signature=String(parts.s||"").trim();
  if(!/^\d+$/.test(timestamp)||!/^[a-f0-9]{64}$/i.test(signature))return false;
  const age=Math.abs(Math.floor(Date.now()/1000)-Number(timestamp));
  if(age>TIKTOK_SIGNATURE_MAX_AGE_SECONDS)return false;
  const raw=Buffer.isBuffer(req.rawBody)?req.rawBody:Buffer.from(JSON.stringify(req.body||{}));
  const expected=crypto.createHmac("sha256",TIKTOK_CLIENT_SECRET).update(timestamp+"."+raw.toString("utf8")).digest("hex");
  const a=Buffer.from(signature.toLowerCase()),b=Buffer.from(expected);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

function parseTikTokContent(value){
  if(value&&typeof value==="object")return value;
  if(typeof value==="string"){try{const parsed=JSON.parse(value);return parsed&&typeof parsed==="object"?parsed:{};}catch{return {};}}
  return {};
}

function extractTikTokLead(body){
  const root=body&&typeof body==="object"?body:{};
  const content=parseTikTokContent(root.content);
  const data=content.data&&typeof content.data==="object"?content.data:{};
  const lead=content.lead&&typeof content.lead==="object"?content.lead:{};
  const fields=content.fields&&typeof content.fields==="object"?content.fields:{};
  const merged={...content,...data,...lead,...fields};
  const externalId=String(merged.lead_id||merged.leadId||merged.external_id||merged.externalId||merged.id||"").trim();
  const name=String(merged.full_name||merged.name||merged.fullName||"").trim();
  const phone=String(merged.phone_number||merged.phone||merged.whatsapp||"").trim();
  const email=String(merged.email||"").trim();
  const event=String(root.event||"").trim();
  return {externalId,name,phone,email,event,content};
}

app.post("/webhooks/tiktok",async(req,res)=>{
  if(!TIKTOK_CLIENT_SECRET||!tiktokSignatureValid(req))return res.sendStatus(403);
  if(!pool||!LEAD_WEBHOOK_WORKSPACE_ID)return res.status(503).json({error:"TikTok integration belum dikonfigurasi di backend"});
  const parsed=extractTikTokLead(req.body||{});
  if(!parsed.externalId)return res.status(200).json({ok:true,ignored:true,reason:"Tiada lead_id/external_id/id dalam event TikTok"});
  if(!parsed.name&&!parsed.phone&&!parsed.email)return res.status(200).json({ok:true,ignored:true,reason:"Event tidak mengandungi name, phone atau email lead"});
  try{
    const normalized=normalizeInboundLead({external_id:parsed.externalId,name:parsed.name,phone:parsed.phone,email:parsed.email,source:"TikTok Lead Ads",funnel_stage:"Cold",notes:`TikTok event=${parsed.event}; client_key=${String(req.body?.client_key||TIKTOK_CLIENT_KEY)}; user_openid=${String(req.body?.user_openid||"")}; create_time=${String(req.body?.create_time||"")}`},"tiktok");
    const result=await ingestNormalizedLead("tiktok",normalized,{tiktok_webhook:req.body||{},tiktok_content:parsed.content});
    return res.status(200).json({ok:true,processed:!result.duplicate,duplicate:Boolean(result.duplicate),lead_id:result.lead_id||result.lead?.id,event_id:result.event_id});
  }catch(err){console.error("TikTok lead processing failed",err);return res.status(err?.status||500).json({error:err?.message||"Gagal menyimpan TikTok lead"});}
});

app.post("/webhooks/meta",async(req,res)=>{
  if(!META_APP_SECRET||!metaSignatureValid(req))return res.sendStatus(403);
  if(!pool||!LEAD_WEBHOOK_WORKSPACE_ID)return res.status(503).json({error:"Meta integration belum dikonfigurasi di backend"});
  const events=[];
  for(const entry of Array.isArray(req.body?.entry)?req.body.entry:[]){
    for(const change of Array.isArray(entry?.changes)?entry.changes:[]){
      if(change?.field!=="leadgen")continue;
      const v=change?.value||{};
      const leadgenId=String(v.leadgen_id||"").trim();
      if(leadgenId)events.push({leadgenId,pageId:String(v.page_id||entry?.id||""),adId:String(v.ad_id||""),adsetId:String(v.adset_id||""),campaignId:String(v.campaign_id||"")});
    }
  }
  let processed=0,duplicates=0,failed=0;
  for(const e of events){
    try{
      const lead=await fetchMetaLead(e.leadgenId),fields=metaFieldMap(lead.field_data);
      const normalized=normalizeInboundLead({
        external_id:e.leadgenId,
        name:fields.full_name||fields.name||fields.first_name||"",
        phone:fields.phone_number||fields.phone||fields.whatsapp||"",
        email:fields.email||"",
        source:"Meta Lead Ads",
        funnel_stage:"Cold",
        notes:`Meta leadgen_id=${e.leadgenId}; page_id=${e.pageId}; ad_id=${e.adId}; adset_id=${e.adsetId}; campaign_id=${e.campaignId}; form_id=${lead.form_id||""}`
      },"meta");
      const result=await ingestNormalizedLead("meta",normalized,{meta_webhook:req.body,meta_lead:lead});
      if(result.duplicate)duplicates++;else processed++;
    }catch(err){failed++;console.error("Meta lead processing failed",err);}
  }
  return res.status(200).json({ok:true,received:events.length,processed,duplicates,failed});
});
// V7.8 — CRM Activity History API
async function ensureCrmActivityTable(){
  if(!pool)return;
  await pool.query(`create table if not exists crm_activities(
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    lead_id uuid not null references leads(id) on delete cascade,
    actor_id uuid references users(id),
    type text not null,
    note text default '',
    next_followup text default '',
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now()
  )`);
  await pool.query("create index if not exists crm_activities_lead_idx on crm_activities(workspace_id,lead_id,occurred_at desc)");
}
app.get("/api/leads/:id/activities",auth,async(req,res)=>{
  if(!pool)return res.json([]);
  const lead=await pool.query("select id from leads where id=$1 and workspace_id=$2 limit 1",[req.params.id,req.user.workspace_id]);
  if(!lead.rowCount)return res.status(404).json({error:"Lead tidak dijumpai"});
  const r=await pool.query("select id,lead_id,type,note,next_followup,occurred_at,created_at from crm_activities where lead_id=$1 and workspace_id=$2 order by occurred_at desc",[req.params.id,req.user.workspace_id]);
  return res.json(r.rows);
});
app.post("/api/leads/:id/activities",auth,async(req,res)=>{
  if(!pool)return res.status(503).json({error:"CRM activity backend memerlukan database production"});
  const lead=await pool.query("select id from leads where id=$1 and workspace_id=$2 limit 1",[req.params.id,req.user.workspace_id]);
  if(!lead.rowCount)return res.status(404).json({error:"Lead tidak dijumpai"});
  const type=String(req.body?.type||"").trim();
  if(!/^[a-zA-Z0-9_-]{1,40}$/.test(type))return res.status(400).json({error:"Activity type tidak sah"});
  const note=String(req.body?.note||"").trim().slice(0,2000);
  const nextFollowup=String(req.body?.next_followup||"").trim().slice(0,120);
  const occurred=String(req.body?.occurred_at||"").trim();
  const occurredAt=occurred?new Date(occurred):new Date();
  if(Number.isNaN(occurredAt.getTime()))return res.status(400).json({error:"occurred_at tidak sah"});
  const r=await pool.query("insert into crm_activities(workspace_id,lead_id,actor_id,type,note,next_followup,occurred_at) values($1,$2,$3,$4,$5,$6,$7) returning id,lead_id,type,note,next_followup,occurred_at,created_at",[req.user.workspace_id,req.params.id,req.user.sub,type,note,nextFollowup,occurredAt]);
  return res.status(201).json(r.rows[0]);
});
app.delete("/api/leads/:id/activities/:activityId",auth,async(req,res)=>{
  if(!pool)return res.status(503).json({error:"CRM activity backend memerlukan database production"});
  const r=await pool.query("delete from crm_activities where id=$1 and lead_id=$2 and workspace_id=$3 returning id",[req.params.activityId,req.params.id,req.user.workspace_id]);
  if(!r.rowCount)return res.status(404).json({error:"Activity tidak dijumpai"});
  return res.json({ok:true,id:req.params.activityId});
});

migrateAndSeed().then(()=>ensureLeadIngestionTable()).then(()=>ensureCrmActivityTable()).then(()=>app.listen(PORT,()=>console.log(`PROPERTY SCE MASTER API ${PORT} V9.2`))).catch(err=>{console.error("Startup failed",err);process.exit(1);});
