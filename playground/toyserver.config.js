const path = require('path')
const blankPlugin = require('./plugins/blankPlugin')

const srcPath = path.resolve(__dirname, '../src/')
const serverConfig = {
  hostname: 'localhost',
  port: 3001,
  open: true,
  https: false,
  httpsOptions: {
    cert: './cert/STAR.pinming.org.crt',
    key: './cert/STAR.pinming.org.pem'
  },
  proxy: {
    // string shorthand
    '/foo': 'http://localhost:4567/foo',
    // with options
    '/api': {
      target: 'http://jsonplaceholder.typicode.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, '')
    }
  }
}
const userConfig = {
  plugins: [blankPlugin],
  eject: {
    path: path.join(__dirname, 'resolved.config.js')
  },
  dryrun: false
}
const config = {
  root: '.',
  alias: {
    react: '@pika/react',
    '/@foo/': path.resolve(__dirname, 'foo-dir')
  },
  resolvers: [
    {
      fileToRequest(filePath) {
        console.log('@@@', filePath)
        if (filePath.startsWith(srcPath)) {
          return `/@/${path.relative(srcPath, filePath)}`
        }
      },
      requestToFile(publicPath) {
        if (publicPath.startsWith('/@/')) {
          return path.join(srcPath, publicPath.replace(/^\/@\//, ''))
        }
        if (publicPath.startsWith('/components/')) {
          return path.join(srcPath, publicPath.replace(/^\/components\//, ''))
        }
      },
      alias: {
        '/@bar/': path.resolve(__dirname, 'bar-dir')
      }
    }
  ],
  mode: 'development',
  env: {
    USER: 'root'
  },
  ...serverConfig,
  ...userConfig
  // define: {
  //   __VALUE__: 'value'
  // },
  // jsx: 'preact',
  // optimizeDeps: {
  //   exclude: ['bootstrap', 'rewrite-unoptimized-test-package'],
  //   link: ['optimize-linked']
  // },
  // cssPreprocessOptions: {
  //   less: {
  //     modifyVars: {
  //       'preprocess-custom-color': 'green'
  //     }
  //   }
  // }
}

module.exports = config
