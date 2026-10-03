const path = require('path');
const webpack = require('webpack');
const { version } = require('./package.json');

module.exports = (env, argv) => {
  const production = argv.mode === 'production';
  return {
    mode: production ? 'production' : 'development',
    devtool: production ? false : 'source-map',
    entry: {
      app: ['whatwg-fetch', './js/app.js'],
      about: ['./js/about.js'],
      venue: ['./js/venues.js'],
      web: ['./js/web.js'],
    },
    output: {
      path: path.resolve(__dirname, 'static'),
      filename: '[name].js',
      // Resolve fonts relative to wherever the bundle is served from
      // (works behind a reverse proxy sub-path as well as at "/").
      publicPath: 'auto',
      assetModuleFilename: 'fonts/[name][ext]',
    },
    performance: { hints: false },
    plugins: [
      new webpack.ProvidePlugin({
        $: 'jquery',
        jQuery: 'jquery',
      }),
      new webpack.DefinePlugin({
        VERSION: JSON.stringify(version),
      }),
    ],
    module: {
      rules: [
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.scss$/,
          use: [
            'style-loader',
            { loader: 'css-loader', options: { sourceMap: !production } },
            {
              loader: 'sass-loader',
              options: {
                sourceMap: !production,
                implementation: require('sass'),
              },
            },
          ],
        },
        {
          test: /\.(woff2?|ttf|eot|svg)(\?.*)?$/,
          type: 'asset/resource',
        },
        {
          test: /\.m?js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: { presets: ['@babel/preset-env'] },
          },
        },
      ],
    },
  };
};
