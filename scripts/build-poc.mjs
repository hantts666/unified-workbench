import webpack from 'webpack';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base={mode:'production',resolve:{extensions:['.tsx','.ts','.js']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:{loader:'ts-loader',options:{transpileOnly:true,compilerOptions:{noEmit:false}}}}]},optimization:{splitChunks:false,runtimeChunk:false},performance:{hints:false}};
const configs=[
  {...base,name:'host',entry:path.join(root,'poc/host.tsx'),output:{path:path.join(root,'dist/poc/host'),filename:'host.js',clean:true,publicPath:'/'},plugins:[new HtmlWebpackPlugin({scriptLoading:'blocking',templateContent:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>统一平台接入验证</title><div id="root"></div><div id="micro-container"></div><pre id="lifecycle"></pre></html>'})]},
  {...base,name:'finance-poc',entry:path.join(root,'poc/child.tsx'),output:{path:path.join(root,'dist/poc/finance'),filename:'child.js',chunkFilename:'[id].[contenthash].js',publicPath:'/micro/poc-finance/',library:{name:'finance-poc',type:'umd'},chunkLoadingGlobal:'webpackJsonp_finance_poc',globalObject:'window',clean:true},plugins:[new HtmlWebpackPlugin({scriptLoading:'blocking',templateContent:'<!doctype html><html><meta charset="utf-8"><div id="finance-root"></div></html>'})]},
];
await new Promise((resolve,reject)=>webpack(configs,(error,stats)=>{if(error||stats.hasErrors())reject(error??new Error(stats.toString({all:false,errors:true})));else{console.log(stats.toString({all:false,timings:true}));resolve();}}));
