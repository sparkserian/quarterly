const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env.local') });

const owner = process.env.GH_RELEASE_OWNER;
const repo = process.env.GH_RELEASE_REPO;

module.exports = {
  appId: 'com.quarterly.desktop',
  artifactName: '${productName}-${version}-${arch}.${ext}',
  directories: {
    output: 'release',
  },
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  mac: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
    category: 'public.app-category.finance',
    target: ['dmg', 'zip'],
  },
  productName: 'Quarterly',
  ...(owner && repo
    ? {
        publish: [
          {
            owner,
            provider: 'github',
            repo,
            releaseType: 'release',
          },
        ],
      }
    : {}),
  win: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
    target: ['nsis'],
  },
};
