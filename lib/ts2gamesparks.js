"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ts = require("typescript");
var fs = require("fs");
var path = require("path");
var mkdirp = require("mkdirp");
var assert = require("assert");
var encoding = "utf8";
var moduleKeyword = "js";
function getTsConfig() {
    var file = ts.findConfigFile(process.cwd(), ts.sys.fileExists);
    var config = ts.readJsonConfigFile(file, ts.sys.readFile);
    var content = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, path.dirname(file));
    return content;
}
function getLanguageService(tsConfig) {
    var files = {};
    tsConfig.fileNames.forEach(function (fileName) {
        files[fileName] = { version: 0 };
    });
    var servicesHost = {
        getScriptFileNames: function () { return tsConfig.fileNames; },
        getScriptVersion: function (fileName) { return files[fileName] && files[fileName].version.toString(); },
        getScriptSnapshot: function (fileName) {
            if (!fs.existsSync(fileName)) {
                return undefined;
            }
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        },
        getCurrentDirectory: function () { return process.cwd(); },
        getCompilationSettings: function () { return tsConfig.options; },
        getDefaultLibFileName: function (options) { return ts.getDefaultLibFilePath(options); },
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    };
    return ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
}
function buildFile(tsConfig, services, filePath) {
    function createSourceFile(filePath, sourceCode, scriptTarget) {
        return ts.createSourceFile(filePath, sourceCode, scriptTarget);
    }
    function getModuleExportsName(name) {
        return moduleKeyword + name;
    }
    function getModuleFuncHeader(name) {
        return getModuleExportsName(name) + "_";
    }
	function trimImport(importName) {
		var ind = importName.indexOf("/");
		return ind >= 0 ? importName.substr(ind+1) : importName;
	}
    function updateTsSourceFileFromData(tsSourceFile) {
        return ts.createPrinter().printFile(tsSourceFile);
    }
    function updateTsSourceFileFromText(tsSourceFile) {
        return createSourceFile(tsSourceFile.fileName, tsSourceFile.text, tsSourceFile.languageVersion);
    }
    function addPropertyRenameInfo(services, filePath, name, renameInfos) {
        if (name) {
            var newName = getModuleFuncHeader(fileName) + name.escapedText;
            return renameInfos.concat(getRenameInfo(services, filePath, name.end, newName));
        }
        return renameInfos;
    }
    function isDeclaration(node) {
        return ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node);
    }
    function getRenameInfo(services, filePath, startPos, newName) {
        var result = services.findRenameLocations(filePath, startPos, false, false);
        return result.filter(function (r) { return r.fileName == filePath; }).map(function (r) {
            return {
                renameLocation: r,
                newName: newName,
            };
        });
    }
    function addExportProperty(fileName, name, properties) {
        if (name) {
            var internalName = name.escapedText;
            var exportName = internalName.substring(getModuleFuncHeader(fileName).length);
			console.assert('!! addExportProperty = ' + internalName + ' / ' + exportName);
            var property = ts.createPropertyAssignment(exportName, ts.createIdentifier(internalName));
            properties.push(property);
        }
    }
    function doRename(tsSourceFile, infos) {
        infos = infos.sort(function (a, b) { return b.renameLocation.textSpan.start - a.renameLocation.textSpan.start; });
        for (var _i = 0, infos_1 = infos; _i < infos_1.length; _i++) {
            var info = infos_1[_i];
            var text = tsSourceFile.text;
            text = text.substr(0, info.renameLocation.textSpan.start) + info.newName + text.substr(info.renameLocation.textSpan.start + info.renameLocation.textSpan.length);
            tsSourceFile.text = text;
        }
        return updateTsSourceFileFromText(tsSourceFile);
    }
    var fileName = path.basename(filePath, ".ts");
    var sourceCode = fs.readFileSync(filePath, encoding);
    var tsSourceFile = createSourceFile(filePath, sourceCode, tsConfig.options.target);
    var identifiers = tsSourceFile.identifiers;
    identifiers.forEach(function (identifier) {
        assert.notEqual(identifier.indexOf(moduleKeyword), 0, "\"{identifier}\" can't use, because \"{keyword}\" is reserved word.".replace("{keyword}", moduleKeyword).replace("{identifier}", identifier));
    });
	var renameInfos = [];
	
	
    var isExportModule = !!tsSourceFile.statements.find(function (s) { return s.modifiers && !!s.modifiers.find(function (m) { return m.kind == ts.SyntaxKind.ExportKeyword; }); });
	if (isExportModule) {
		/*
        tsSourceFile.forEachChild(function (node) {
            if (isDeclaration(node)) {
                renameInfos = addPropertyRenameInfo(services, filePath, node.name, renameInfos);
            }
            else if (ts.isVariableStatement(node)) {
                node.declarationList.declarations.forEach(function (declaration) {
                    renameInfos = addPropertyRenameInfo(services, filePath, declaration.name, renameInfos);
                });
            }
        });
		*/
    }
	
	
	var exportModules = [];
	tsSourceFile.statements.forEach(function(s) {
		if (s.modifiers && s.modifiers.find(function (m) { return m.kind == ts.SyntaxKind.ExportKeyword; })) {
			//console.assert(s.name != undefined, '!! export node = ' + JSON.stringify(s));
			exportModules.push(s.name.escapedText);
		}
	});
	//console.assert(false, '!! export modules = ' + JSON.stringify(exportModules));
	
	
	var importModules = [];
	
    tsSourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node)) {
            if (node.importClause.namedBindings.name) {
                var namedBindings = node.importClause.namedBindings;
				var importFileName = trimImport(node.moduleSpecifier.text);
                //renameInfos = renameInfos.concat(getRenameInfo(services, filePath, 
				//		namedBindings.name.end, getModuleExportsName(importFileName)));
                if (importModules.indexOf(node.moduleSpecifier.text) == -1)
                    importModules.push(node.moduleSpecifier.text);
            }
        }
    });
    tsSourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node)) {
            if (node.importClause.namedBindings.elements) {
                var namedBindings = node.importClause.namedBindings;
                namedBindings.elements.forEach(function (element) {
                    var funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;
					var importFileName = trimImport(node.moduleSpecifier.text);
                    var funcHeader = getModuleFuncHeader(importFileName);
                    //renameInfos = renameInfos.concat(getRenameInfo(services, filePath, element.name.end, funcHeader + funcName));
                    if (importModules.indexOf(node.moduleSpecifier.text) == -1)
                        importModules.push(node.moduleSpecifier.text);
                });
            }
        }
    });
	/*
    tsSourceFile = doRename(tsSourceFile, renameInfos);
	importModules.forEach(function (element) {
		tsSourceFile.text = tsSourceFile.text.replace(element, trimImport(element));
	});
	
	tsSourceFile.text = tsSourceFile.text.replace('export ', '');
	exportModules.forEach(function (element) {
		tsSourceFile.text += "\nexport = " + element + ";";
	});
	*/
    tsSourceFile = updateTsSourceFileFromText(tsSourceFile);
	/*
    if (isExportModule) {
        var properties_1 = [];
        for (var i = 0; i < tsSourceFile.statements.length; i++) {
            var node = tsSourceFile.statements[i];
            if (node.modifiers && node.modifiers.find(function (m) { return m.kind == ts.SyntaxKind.ExportKeyword; })) {
                node.modifiers = node.modifiers.filter(function (m) { return m.kind != ts.SyntaxKind.ExportKeyword; });
                if (isDeclaration(node)) {
                    addExportProperty(fileName, node.name, properties_1);
                }
                else if (ts.isVariableStatement(node)) {
                    node.declarationList.declarations.forEach(function (declaration) {
                        addExportProperty(fileName, declaration.name, properties_1);
                    });
                }
            }
        }
        var moduleExports = ts.createVariableStatement(
			undefined, 
			ts.createVariableDeclarationList(
				[
					ts.createVariableDeclaration(
						getModuleExportsName(fileName), 
						undefined, 
						ts.createObjectLiteral(properties_1, true)
					)
				], 
				ts.NodeFlags.None
			)
		);
		console.assert(false, '!! moduleExports = ' + JSON.stringify(moduleExports));
        tsSourceFile.statements.push(moduleExports);
    }
	*/
	/*
    tsSourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node)) {
            delete node.importClause;
        }
    });
    */
    var js = ts.transpileModule(updateTsSourceFileFromData(tsSourceFile), { compilerOptions: tsConfig.options }).outputText;
    var newLine = ts.getNewLineCharacter(tsConfig.options);
    js = js.replace('Object.defineProperty(exports, "__esModule", { value: true });' + newLine, "");
	//js = js.replace(/exports./g, 'module.exports.');
	//js = js.replace(/d.__proto__ = b;/g, 'd.__proto__ = b.prototype;');
	
    /*
    importModules.forEach(function (moduleName) {
		var trimModuleName = trimImport(moduleName);
        assert.equal(trimModuleName.indexOf("/"), -1, "Relative path is not supported on Cloud Code, please change to file name: " + trimModuleName);
        var exportName = getModuleExportsName(moduleName);
        var header = getModuleFuncHeader(moduleName);
        js = js.replace(new RegExp(exportName + "." + header, "g"), exportName + ".");
		//js = js.replace(new RegExp(moduleName + "." + moduleName, "g"), moduleName + ".");
    });
    */
	js = js.replace(/require.*\(["'][^"']*["']/g, function(str) { 
		var s = str.replace(/"/g,"'");
		var b = s.indexOf("'");
		var e = s.indexOf("'", b+1);
		//assert(false, '!! replacing = ' + s + ' / ' + b + ' / ' + e);
        //return 'var ' + str.substr(b+1,e-b-1) + ' = ' + str;
        var importPath = str.substr(b+1,e-b-1);
        var ind = importPath.lastIndexOf('/');
        importPath = ind >= 0 ? importPath.substr(ind+1) : importPath;
        return str.substr(0,b+1) + importPath + str.substr(e); 
	});
    var output = services.getEmitOutput(filePath);
    output.outputFiles.forEach(function (o) {
        mkdirp.sync(path.dirname(o.name));
        fs.writeFileSync(o.name, js, encoding);
    });
}
var tsConfig = getTsConfig();
var services = getLanguageService(tsConfig);
var diagnostics = services.getCompilerOptionsDiagnostics();
assert(diagnostics.length == 0, diagnostics.length > 0 ? diagnostics[0].messageText.toString() : "");
tsConfig.fileNames.forEach(function (file) {
    buildFile(tsConfig, services, file);
});
