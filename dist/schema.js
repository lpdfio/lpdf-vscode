"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLpdfDocument = isLpdfDocument;
exports.ensureSchemaAssociation = ensureSchemaAssociation;
const vscode = __importStar(require("vscode"));
// Cache isLpdfDocument results keyed by URI → {version, result}.
// Avoids re-scanning the document on every CodeLens / status-bar refresh.
const _isLpdfCache = new Map();
function isLpdfDocument(doc) {
    if (doc.languageId !== 'xml')
        return false;
    const key = doc.uri.toString();
    const cached = _isLpdfCache.get(key);
    if (cached && cached.version === doc.version) {
        return cached.result;
    }
    const result = /<lpdf\b/.test(doc.getText().substring(0, 512));
    _isLpdfCache.set(key, { version: doc.version, result });
    return result;
}
/**
 * Associate the LPDF XSD with the specific file that was just confirmed to contain <lpdf.
 * Uses a per-file workspace pattern instead of **\/*.xml so only confirmed LPDF files
 * get schema validation — unrelated XML files in the workspace are unaffected.
 *
 * Also migrates away from any legacy **\/*.xml catch-all entry written by older versions,
 * and cleans up stale per-file entries the original implementation wrote to global config.
 */
async function ensureSchemaAssociation(doc, xsdPath) {
    if (!isLpdfDocument(doc))
        return;
    const systemId = vscode.Uri.file(xsdPath).toString();
    const config = vscode.workspace.getConfiguration('xml');
    const inspection = config.inspect('fileAssociations');
    // 1. Clean up stale global entries written by the original implementation.
    const globalEntries = inspection?.globalValue ?? [];
    const globalCleaned = globalEntries.filter(a => a.systemId !== systemId);
    if (globalCleaned.length !== globalEntries.length) {
        await config.update('fileAssociations', globalCleaned.length > 0 ? globalCleaned : undefined, vscode.ConfigurationTarget.Global);
    }
    // 2. Add a per-file entry; migrate away from the legacy **/*.xml catch-all if present.
    const filePattern = vscode.workspace.asRelativePath(doc.uri, false);
    const workspaceEntries = inspection?.workspaceValue ?? [];
    const hasLegacyWildcard = workspaceEntries.some(a => a.systemId === systemId && a.pattern === '**/*.xml');
    const hasFileEntry = workspaceEntries.some(a => a.systemId === systemId && a.pattern === filePattern);
    if (!hasLegacyWildcard && hasFileEntry) {
        return;
    } // already correctly configured
    const base = hasLegacyWildcard
        ? workspaceEntries.filter(a => !(a.systemId === systemId && a.pattern === '**/*.xml'))
        : workspaceEntries;
    await config.update('fileAssociations', [...base, ...(hasFileEntry ? [] : [{ systemId, pattern: filePattern }])], vscode.ConfigurationTarget.Workspace);
}
//# sourceMappingURL=schema.js.map