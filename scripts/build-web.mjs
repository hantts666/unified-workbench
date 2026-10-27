import webpack from "webpack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import path from "node:path";
const target = process.argv[2];
if (!["portal", "finance", "sample"].includes(target))
  throw new Error("Choose portal, finance or sample");
const micro = target !== "portal",
  root = process.cwd();
const config = {
  mode: "production",
  entry: path.join(root, `apps/${target}-web/src/main.tsx`),
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: { transpileOnly: true, compilerOptions: { noEmit: false } },
        },
      },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
    ],
  },
  output: {
    path: path.join(root, `dist/${target}`),
    filename: "app.[contenthash].js",
    chunkFilename: "[id].[contenthash].js",
    publicPath: micro ? `/micro/${target}/` : "/",
    ...(micro
      ? {
          library: { name: target, type: "umd" },
          chunkLoadingGlobal: `webpackJsonp_unified_${target}`,
        }
      : {}),
    globalObject: "window",
    clean: true,
  },
  optimization: { splitChunks: false, runtimeChunk: false },
  performance: { hints: false },
  plugins: [
    new HtmlWebpackPlugin({
      scriptLoading: "blocking",
      templateContent: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${micro ? "业务应用" : "合一工作台"}</title></head><body><div id="${micro ? target + "-root" : "root"}"></div></body></html>`,
    }),
  ],
};
await new Promise((resolve, reject) =>
  webpack(config, (error, stats) => {
    if (error || stats.hasErrors())
      reject(error ?? new Error(stats.toString({ all: false, errors: true })));
    else {
      console.log(
        `${target}: ${stats.toString({ all: false, timings: true })}`,
      );
      resolve();
    }
  }),
);
