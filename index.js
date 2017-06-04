var fs = require('fs');

var dss = require('../helpers/dss-helper');
var gp, id;
var featuresDir;

var chai = require('chai'),
    should = chai.should(),
    expect = chai.expect,
    assert = chai.assert;

var modules = {};

var debug = 1;

describe("Test Engine", function() {
    if (process.env.DEBUG) {
        debug = process.env.DEBUG;
    }

    gp = require(process.env.MTS_GLOBALS).gp;
    id = require(process.env.MTS_ELEMENTS).id;
    featuresDir = process.env.MTS_LIBRARIES;

    var testScript = process.env.MTS_SCRIPT;
    var scriptName = testScript.substr(testScript.lastIndexOf('/'));

    dss.init(this);

    describe("Run Script Test: " + scriptName, function() {
        it("Execute Script Test: " + testScript, function() {
            return executeScript(openScriptFile(testScript));
        });

        function debug(message) {
            if (debug) {
                console.log(message);
            }
        }

        function error(message) {
            console.error(message);
            dss.getDriver().quit();
        }

        function openScriptFile(scriptName) {
            debug("Running Script: " + testScript);
            var contents = fs.readFileSync(scriptName).toString();
            debug("Contents:\n" + contents);
            return contents;
        }

        function readNextLine(contents) {
            var endIndex = contents.indexOf('\n');
            var line = contents.substr(0, endIndex);
            debug("Read line: " + line);
            return {line: line, endIndex: endIndex};
        }

        function parseCommandString(commandString) {
            var parts = [];
            var token = "";
            var c;
            var quote = 0, dblquote = 0;

            for (var i = 0; i < commandString.length; i++) {
                c = commandString.charAt(i);
                switch (c) {
                    case ' ':
                    case '\t':
                        if (quote || dblquote) {
                            token += c;
                        }
                        else {
                            parts.push(token);
                            token = "";
                        }
                    break;
                    case '\"':
                        if (quote) {
                            token += c;
                        }
                        else if (dblquote) {
                            parts.push(token);
                            token = "";
                            dblquote = 0;
                        }
                        else {
                            dblquote = 1;
                        }
                    break;
                    case '\'':
                        if (dblquote) {
                            token += c;
                        }
                        else if (quote) {
                            parts.push(token);
                            token = "";
                            quote = 0;
                        }
                        else {
                            quote = 1;
                        }
                    break;
                    default:
                        token += c;
                    break;
                }
            }
            parts.push(token);

            return parts;
        }

        function parseScript(contents) {
            var commands = [];
            var done = 0;
            var remainingContents = contents;
            var lineNumber = 0;

            while (!done) {
                lineNumber++;
                var result = readNextLine(remainingContents);
                result.lineNumber = lineNumber;
                if (result.line.trim() != '' && !result.line.trim().startsWith("//")) {
                    debug("Adding command: " + JSON.stringify(result));
                    commands.push({
                        commandText: result.line,
                        commandParts: parseCommandString(result.line)
                    });
                }
                remainingContents = remainingContents.substr(result.endIndex + 1);
                if (result.endIndex == -1) {
                    done = 1;
                }
            }

            return commands;
        }

        function parseCommand(command) {
            command.mainCommand = command.commandParts.shift();
            command.mainCommandParts = command.mainCommand.split('.');
            command.coreCommand = command.mainCommandParts.pop();
            command.args = command.commandParts;
            delete command.commandParts;
            debug("Command: " + JSON.stringify(command));

            var requirePath = featuresDir;
            for (var i = 0; i < command.mainCommandParts.length; i++) {
                requirePath += '/' + command.mainCommandParts[i];
            }

            if (command.mainCommandParts && command.mainCommandParts.length > 0) {
                var libName = command.mainCommandParts[command.mainCommandParts.length - 1];
                if (!modules.hasOwnProperty(libName)) {
                    debug("Adding lib: " + libName + ": " + requirePath);
                    modules[libName] = require(requirePath);
                }
            }
        }

        function resolveArg(arg) {
            var value;

            if ((arg.startsWith("\"") && arg.endsWith("\""))
                    || (arg.startsWith("\'") && arg.endsWith("\'"))) {
                value = arg.substring(0, arg.length - 2);
            }
            else if (!isNaN(parseFloat(arg)) && isFinite(arg)) { // isNumeric
                value = arg;
            }
            else {
                var parts = arg.split(".");
                value = gp;
                for (var i = 0; i < parts.length; i++) {
                    value = value[parts[i]]
                }
            }

            debug("Resolve arg: " + arg + ": " + value);

            return value;
        }

        function resolveCommandArgs(commandArgs) {
            var args = [null];

            for (var i = 0; i < commandArgs.length; i++) {
                args.push(resolveArg(commandArgs[i]));
            }

            return args;
        }

        function resolveElement(arg) {
            var parts = arg.split(".");
            var value = id;

            for (var i = 0; i < parts.length; i++) {
                value = value[parts[i]]
            }

            debug("Resolve element: " + arg + ": " + value);

            return value;
        }

        /*
         * assert <operator> <element id> <expected value>
         */
        function checkValue(command, promise) {
            debug("assert: " + command.args.join());

            var checkCommand = command.args[0];
            var actualElement = resolveElement(command.args[1]);
            var expectedValue;

            if (command.args.length > 2) {
                expectedValue = command.args[2];
            }

            return promise.elementByXPath(actualElement).getAttribute('label').then(function(actualValue) {
                var checkFunction = assert[checkCommand];
                if (command.args.length > 2) {
                    checkFunction(actualValue, expectedValue);
                }
                else {
                    checkFunction(actualValue);
                }
            });
        }

        function log(command) {
            command.args.forEach(function(line) {
                console.log(line);
            });
        }

        function sleep(command, promise) {
            return promise.sleep(Number(command.args[0]));
        }

        function executeTestCommand(command, promise) {
            var libName, module;
            
            if (command.mainCommandParts && command.mainCommandParts.length > 0) {
                libName = command.mainCommandParts[command.mainCommandParts.length - 1];
                debug("Lookup library: " + libName);
                module = modules[libName];
            }

            var args = resolveCommandArgs(command.args);
            debug("Execute " + command.coreCommand + " with args: " + args);

            var commandFunction = module[command.coreCommand];
            var bindFunction = commandFunction.bind;
            var p = promise.sleep(1000);
            switch(command.args.length) {
                case 0:
                    return p.then(commandFunction);
                default:
                    return p.then(bindFunction.apply(commandFunction, args));
            }
        }

        /*
         * element/waitForElement <element id> click
         * element/waitForElement <element id> tap x y
         * element/waitForElement <element id> swipe startX startY endX endY duration
         *
         * element/waitForElement <element id> "string" // defaults to 'type' command
         * element/waitForElement <element id> type/keys/setValue "string"
         */
        function element(command, promise, wait) {
            var action = (command.args.length > 1 ? command.args[1] : 'none');
            var actualElement = resolveElement(command.args[0]);
            var typeText, elementPromise;

            // special handling for type if you just specify a string in quotes
            if (action.startsWith('\"') || action.startsWith('\'')) {
                typeText = action;
                action = 'type';
            }

            // wait vs no wait logic
            if (wait) {
                if (actualElement.startsWith("//*")) {
                    elementPromise = promise.waitForElementByXPath(actualElement, undefined, 1000, 9000);
                }
                else {
                    elementPromise = promise.waitForElementByAccessibilityId(actualElement, undefined, 1000, 9000);   
                }
            }
            else {
                if (actualElement.startsWith("//*")) {
                    elementPromise = promise.elementByXPath(actualElement);
                }
                else {
                    elementPromise = promise.elementByAccessibilityId(actualElement);
                }
            }

            switch (action) {
                case 'click':
                    console.log("Clicking element " + command.args[0]);
                    return elementPromise.click();

                case 'tap':
                    console.log("Tapping element " + command.args[0]);
                    var x = command.args.length > 2 ? command.args[2] : -1;
                    var y = command.args.length > 3 ? command.args[3] : -1;
                    if (x == -1 || y == -1) {
                        error('Both x and y coordinates (in that order) must be supplied for tap command on line ' + command.lineNumber);
                    }
                    return elementPromise.tap({x: x, y: y});

                case 'swipe':
                    console.log("Swiping element " + command.args[0]);
                    var sx = command.args.length > 2 ? command.args[2] : -1;
                    var sy = command.args.length > 3 ? command.args[3] : -1;
                    var ex = command.args.length > 4 ? command.args[4] : -1;
                    var ey = command.args.length > 5 ? command.args[5] : -1;
                    var duration = command.args.length > 6 ? command.args[6] : -1;
                    if (sx == -1 || sy == -1 || ex == -1 || ey == -1 || duration == -1) {
                        error('startX, startY, endX, endY, and duration (in that order) must be supplied for swipe command on line ' + command.lineNumber);
                    }
                    return elementPromise.swipe({startX: sx, startY: sy, endX: ex, endY: ey, duration: duration});

                case 'type':
                case 'keys':
                case 'setValue':
                    typeText = (command.args.length > 2 ? command.args[2] : 'none');
                    console.log("Typing text " + typeText + " into element " + command.args[0]);
                    if (typeText == 'none') {
                        error('No text given for type command on line ' + command.lineNumber);
                    }
                    return action == 'type' ? elementPromise.type(typeText) : (action == 'keys' ? elementPromise.keys(typeText) : elementPromise.setImmediateValue(typeText));

                case 'none':
                default:
                    console.log("Element no-op " + command.args[0]);
                    return elementPromise;
            }
        }

        function executeCommand(command, promise) {
            debug("Core Command: " + command.coreCommand);
            switch (command.coreCommand) {
                case 'sleep':
                    return sleep(command, promise);
                case 'log':
                    log(command);
                    return promise;
                case 'assert':
                    return checkValue(command, promise);
                case 'runScript':
                    return executeScript(openScriptFile(command.args[0]), promise);
                case 'element':
                case 'waitForElement':
                    return element(command, promise, command.coreCommand == 'waitForElement');
                default:
                    return executeTestCommand(command, promise);
            }
        }

        function executeScript(contents, aPromise) {
            var commands = parseScript(contents);

            for (var i = 0; i < commands.length; i++) {
                parseCommand(commands[i]);
            }

            var promise = aPromise ? aPromise : dss.getDriver();
            for (var j = 0; j < commands.length; j++) {
                promise = executeCommand(commands[j], promise);
            }

            return promise;
        }
    });
});

// test case and suite support
// execute test case in another script file/script library
// getting values and save off in variables
// support for control structures - if, for, while, etc
// retries
// assertions counter

