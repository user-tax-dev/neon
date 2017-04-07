import { remove, copy, readFile } from '../async/fs';
import { spawn } from '../async/child_process';
import path from 'path';
import handlebars from 'handlebars';
import * as style from './style';
import { removeSync, copySync } from 'fs-extra';
import TOML from 'toml';
import clone from 'shallow-copy';

const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates');

const LIB_PREFIX = {
  'darwin':  "lib",
  'freebsd': "lib",
  'linux':   "lib",
  'sunos':   "lib",
  'win32':   ""
};

const LIB_SUFFIX = {
  'darwin':  ".dylib",
  'freebsd': ".so",
  'linux':   ".so",
  'sunos':   ".so",
  'win32':   ".dll"
};

function explicit_cargo_target() {
  if (process.platform === 'win32') {
    let arch = process.env.npm_config_arch || process.arch;
    if (arch === 'ia32') {
      return 'i686-pc-windows-msvc';
    } else {
      return 'x86_64-pc-windows-msvc';
    }
  }
}

function cargo(root, toolchain, configuration, nodeModuleVersion, target) {
  let macos = process.platform === 'darwin';

  let prefix = toolchain === 'default' ? [] : ["+" + toolchain];

  let args = prefix.concat(macos ? 'rustc' : 'build',
                           configuration === 'release' ? ["--release"] : [],
                           macos ? ["--", "-C", "link-args=-Wl,-undefined,dynamic_lookup"] : []);

  // Pass the Node modules ABI version to the build as an environment variable.
  let env = clone(process.env);
  env.NEON_NODE_ABI = nodeModuleVersion || process.versions.modules;

  if (target) {
    args.push("--target=" + target);
  }

  console.log(style.info(["cargo"].concat(args).join(" ")));

  return spawn("cargo", args, { cwd: path.resolve(root, 'native'), stdio: 'inherit', env: env });
}

async function main(root, name, configuration, target) {
  let pp = process.platform;
  let output_directory = target ?
    path.resolve(root, 'native', 'target', target, configuration) :
    path.resolve(root, 'native', 'target', configuration);
  let dylib = path.resolve(output_directory, LIB_PREFIX[pp] + name + LIB_SUFFIX[pp]);
  let index = path.resolve(root, 'native', 'index.node');

  console.log(style.info("generating native" + path.sep + "index.node"));

  await remove(index);
  await copy(dylib, index);
}

export default async function neon_build(root, toolchain, configuration, nodeModuleVersion) {
  // 1. Read the Cargo metadata.
  let metadata = TOML.parse(await readFile(path.resolve(root, 'native', 'Cargo.toml'), 'utf8'));

  if (!metadata.lib.name) {
    throw new Error("Cargo.toml does not contain a [lib] section with a 'name' field");
  }

  let target = explicit_cargo_target();

  console.log(style.info("running cargo"));

  // 2. Build the binary.
  if ((await cargo(root, toolchain, configuration, nodeModuleVersion, target)) !== 0) {
    throw new Error("cargo build failed");
  }

  // 3. Copy the dylib into the main index.node file.
  await main(root, metadata.lib.name, configuration, target);
}
