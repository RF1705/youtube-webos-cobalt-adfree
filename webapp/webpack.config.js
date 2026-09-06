const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const outputPath = path.resolve(__dirname, './output');

function cleanOutputDir() {
  if (fs.existsSync(outputPath)) {
    fs.rmSync(outputPath, { recursive: true, force: true });
  }
  fs.mkdirSync(outputPath, { recursive: true });
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

module.exports = (env) => {
  cleanOutputDir();
  const enableDebugOverlay = truthy(process.env.YTAF_DEBUG || env.debug || env.ytafDebug);

  return [
    {
      mode: env.production ? 'production' : 'development',

      target: ['web', 'es5'],

      // Builds with devtool support (development) contain very big eval chunks,
      // which seem to cause segfaults (at least) on nodeJS v0.12.2 used on webOS 3.x.
      // This feature makes sense only when using recent enough chrome-based
      // node inspector anyway.
      devtool: env.production ? false : 'source-map',

      optimization: {
        minimize: env.production ? true : false,
        runtimeChunk: false,
        minimizer: [
          '...',
        ]
      },

      entry: {
        adblockPreload: './src/adblock-preload.js',
        adblockMain: './src/adblock-main.js'
      },
      output: {
        path: outputPath,
        environment: {
          arrowFunction: false,
          bigIntLiteral: false,
          const: false,
          destructuring: false,
          dynamicImport: false,
          forOf: false,
          module: false,
          optionalChaining: false,
          templateLiteral: false
        }
      },
      resolve: {
        extensions: ['.ts', '.js']
      },
      module: {
        rules: [
          {
            test: /\.m?js$/,
            loader: 'babel-loader',
            exclude: [
              // Some module should not be transpiled by Babel
              // See https://github.com/zloirock/core-js/issues/743#issuecomment-572074215
              // \\ for Windows, / for macOS and Linux
              /node_modules[\\/]core-js/,
              /node_modules[\\/]webpack[\\/]buildin/
            ],
            options: {
              cacheDirectory: true
            }
          },
          {
            test: /\.css$/i,
            use: [
              MiniCssExtractPlugin.loader,
              { loader: 'css-loader', options: { esModule: false } }
            ]
          }
        ]
      },
      plugins: [
        new webpack.DefinePlugin({
          __YTAF_DEBUG__: JSON.stringify(enableDebugOverlay)
        }),
        new MiniCssExtractPlugin({
          chunkFilename: '[id].css'
        })
      ]
    }
  ];
};
