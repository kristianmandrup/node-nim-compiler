import fs from "fs"
import path from "path"
import spawn from "cross-spawn"
import _ from "lodash";
var nimBinaryName = "nim";
import _temp from "temp"
import w from "./worker"
const temp = _temp.track();

var defaultOptions = {
  spawn: spawn,
  cwd: undefined,
  pathToNim: undefined,
  help: undefined,
  output: undefined,
  report: undefined,
  debug: undefined,
  verbose: false,
  processOpts: undefined,
  docs: undefined,
  optimize: undefined,
};

var supportedOptions = _.keys(defaultOptions);

function prepareSources(sources) {
  if (!(sources instanceof Array || typeof sources === "string")) {
    throw "compile() received neither an Array nor a String for its sources argument.";
  }

  return typeof sources === "string" ? [sources] : sources;
}

function prepareOptions(options, spawnFn) {
  return _.defaults({ spawn: spawnFn }, options, defaultOptions);
}

function prepareProcessArgs(sources, options) {
  var preparedSources = prepareSources(sources);
  var compilerArgs = compilerArgsFromOptions(options);

  return ["make"].concat(preparedSources ? preparedSources.concat(compilerArgs) : compilerArgs);
}

function prepareProcessOpts(options) {
  var env = _.merge({ LANG: 'en_US.UTF-8' }, process.env);
  return _.merge({ env: env, stdio: "inherit", cwd: options.cwd }, options.processOpts);

}

function runCompiler(sources, options, pathToNim) {
  if (typeof options.spawn !== "function") {
    throw "options.spawn was a(n) " + (typeof options.spawn) + " instead of a function.";
  }

  var processArgs = prepareProcessArgs(sources, options);
  var processOpts = prepareProcessOpts(options);

  if (options.verbose) {
    console.log(["Running", pathToNim].concat(processArgs).join(" "));
  }

  return options.spawn(pathToNim, processArgs, processOpts);
}

function compilerErrorToString(err, pathToNim) {
  if ((typeof err === "object") && (typeof err.code === "string")) {
    switch (err.code) {
      case "ENOENT":
        return "Could not find Nim compiler \"" + pathToNim + "\". Is it installed?";

      case "EACCES":
        return "Nim compiler \"" + pathToNim + "\" did not have permission to run. Do you need to give it executable permissions?";

      default:
        return "Error attempting to run Nim compiler \"" + pathToNim + "\":\n" + err;
    }
  } else if ((typeof err === "object") && (typeof err.message === "string")) {
    return JSON.stringify(err.message);
  } else {
    return "Exception thrown when attempting to run Nim compiler " + JSON.stringify(pathToNim);
  }
}

function compileSync(sources, options) {
  var optionsWithDefaults = prepareOptions(options, options.spawn || spawn.sync);
  var pathToNim = options.pathToNim || nimBinaryName;

  try {
    return runCompiler(sources, optionsWithDefaults, pathToNim);
  } catch (err) {
    throw compilerErrorToString(err, pathToNim);
  }
}

function compile(sources, options) {
  var optionsWithDefaults = prepareOptions(options, options.spawn || spawn);
  var pathToNim = options.pathToNim || nimBinaryName;


  try {
    return runCompiler(sources, optionsWithDefaults, pathToNim)
      .on('error', function (err) { throw (err); });
  } catch (err) {
    throw compilerErrorToString(err, pathToNim);
  }
}

function getSuffix(outputPath, defaultSuffix) {
  if (outputPath) {
    return path.extname(outputPath) || defaultSuffix;
  } else {
    return defaultSuffix;
  }
}

// write compiled Nim to a string output
// returns a Promise which will contain a Buffer of the text
// If you want html instead of js, use options object to set
// output to a html file instead
// creates a temp file and deletes it after reading
function compileToString(sources, options) {
  const suffix = getSuffix(options.output, '.js');

  return new Promise(function (resolve, reject) {
    temp.open({ suffix }, function (err, info) {
      if (err) {
        return reject(err);
      }

      options.output = info.path;
      options.processOpts = { stdio: 'pipe' }

      var compiler;

      try {
        compiler = compile(sources, options);
      } catch (compileError) {
        return reject(compileError);
      }

      compiler.stdout.setEncoding("utf8");
      compiler.stderr.setEncoding("utf8");

      var output = '';
      compiler.stdout.on('data', function (chunk) {
        output += chunk;
      });
      compiler.stderr.on('data', function (chunk) {
        output += chunk;
      });

      compiler.on("close", function (exitCode) {
        if (exitCode !== 0) {
          return reject(new Error('Compilation failed\n' + output));
        } else if (options.verbose) {
          console.log(output);
        }

        fs.readFile(info.path, { encoding: "utf8" }, function (err, data) {
          return err ? reject(err) : resolve(data);
        });
      });
    });
  });
}

function compileToStringSync(sources, options) {
  const suffix = getSuffix(options.output, '.js');

  const file = temp.openSync({ suffix });
  options.output = file.path;
  compileSync(sources, options);

  return fs.readFileSync(file.path, { encoding: "utf8" });
}

// Converts an object of key/value pairs to an array of arguments suitable
// to be passed to child_process.spawn for nim-make.
function compilerArgsFromOptions(options) {
  return _.flatten(_.map(options, function (value, opt) {
    if (value) {
      switch (opt) {
        case "help": return ["--help"];
        case "output": return ["--output", value];
        case "report": return ["--report", value];
        case "debug": return ["--debug"];
        case "docs": return ["--docs", value];
        case "optimize": return ["--optimize"];
        case "runtimeOptions": return [].concat(["+RTS"], value, ["-RTS"]);
        default:
          if (supportedOptions.indexOf(opt) === -1) {
            throw new Error('node-nim-compiler was given an unrecognized Nim compiler option: ' + opt);
          }
          return [];
      }
    } else {
      return [];
    }
  }));
}

export default {
  compile: compile,
  compileSync: compileSync,
  compileWorker: w(compile),
  compileToString: compileToString,
  compileToStringSync: compileToStringSync,
  _prepareProcessArgs: prepareProcessArgs
};
