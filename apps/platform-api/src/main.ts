import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {db} from './db.js';
import {registerAuth} from './auth.js';
import {registerManagement} from './management.js';
import {registerIntrospection} from './authorization.js';
import {seedBootstrap} from './seed.js';
import {errors,requireOrigin,route} from './http.js';
class PlatformModule {}
Module({})(PlatformModule);
export async function createPlatformApp(){
  const app=await NestFactory.create(PlatformModule,{logger:false,bodyParser:false});
  app.use(helmet({contentSecurityPolicy:false}));
  app.use(express.json({limit:'200kb'}));app.use(cookieParser());
  app.use((_req:any,res:any,next:any)=>{res.setHeader('Cache-Control','no-store');next();});
  const router=express.Router();router.use(requireOrigin);
  router.get('/health',route(async(_req,res)=>{await db.$queryRaw`SELECT 1`;res.json({status:'ok',service:'platform-api',revision:process.env.APP_REVISION??'development'});}));
  registerAuth(router);
  registerManagement(router);
  app.use('/api/platform',router);
  const internal=express.Router();registerIntrospection(internal);app.use('/internal',internal);
  app.use(errors);
  await app.init();return app;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await seedBootstrap();
  const app=await createPlatformApp();await app.listen(Number(process.env.PORT??3101),'0.0.0.0');
  console.log('Platform API ready');
  process.once('SIGTERM',async()=>{await app.close();await db.$disconnect();process.exit(0);});
}
