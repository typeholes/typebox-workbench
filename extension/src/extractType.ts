import * as vscode from 'vscode';
import { TypeScriptToModel } from '../../src/codegen/typescript/typescript-to-model';
import { ModelToArkType } from '../../src/codegen/model/model-to-arktype';
import { ModelToIoTs } from '../../src/codegen/model/model-to-io-ts';
import { ModelToExpr } from '../../src/codegen/model/model-to-expression';
import { ModelToJavaScript } from '../../src/codegen/model/model-to-javascript';
import { ModelToJsonSchema } from '../../src/codegen/model/model-to-json-schema';
import { TypeScriptToTypeBox } from '../../src/codegen/typescript/typescript-to-typebox';
import { ModelToValue } from '../../src/codegen/model/model-to-value';
import { ModelToZod } from '../../src/codegen/model/model-to-zod';
import { undoStack } from './undoStack';
import {
   getQuickInfo,
   interfaceToType,
   resolveTypeDeps,
   commentOldTypes,
   onExpandedSelection,
   QuickInfoResult,
   getRangeText,
} from './util';
import { TypeBoxModel } from '../../src/codegen/model/model';

const extractions = {
   ArkType: mkTypeBenchExtract(ModelToArkType),
   IoTs: mkTypeBenchExtract(ModelToIoTs),
   Expr: mkTypeBenchExtract(ModelToExpr),
   Javascript: mkTypeBenchExtract(ModelToJavaScript),
   JsonSchema: mkTypeBenchExtract(ModelToJsonSchema),
   TypeBox: { transform: TypeScriptToTypeBox.Generate },
   SampleValue: mkTypeBenchExtract(ModelToValue),
   Zod: mkTypeBenchExtract(ModelToZod),
   Interfaces2Types: { transform: (code: string) => code },
   Identity: { transform: (code: string) => code },
} as const;

export const defaultExtractor = {
   extraction: 'Identity' as keyof typeof extractions,
   interfaces2types: true,
   commentOldTypes: false,
   target: 'newDocument' as 'clipboard' | 'inplace' | 'newDocument',
   language: 'typescript',
   autoUndo: true,
};

export type Extractor = typeof defaultExtractor;

export function setDefaultExtractor(values: Extractor) {
   Object.assign(defaultExtractor, values);
}

export const extractors: Record<string, Extractor> = {};

export function setExtractors(values: Record<string, Extractor>) {
   Object.assign(extractors, values);
}

function mkTypeBenchExtract(generator: {
   Generate: (m: TypeBoxModel) => string;
}) {
   return {
      transform: (code: string) => {
         const model = TypeScriptToModel.Generate(code);
         const output = generator.Generate(model);
         return output;
      },
   };
}

export async function extractType(
   textEditor: vscode.TextEditor,
   extract: Extractor
) {
   if (
      extract.target === 'inplace' ||
      extract.commentOldTypes ||
      extract.interfaces2types ||
      extract.autoUndo
   ) {
      undoStack.track();
   } else {
      undoStack.ignore();
   }
   undoStack.registerChange(textEditor.document);

   let namePosition = textEditor.selection.active;
   const offset = textEditor.document.offsetAt(namePosition);
   const file = textEditor.document.fileName;

   let result: QuickInfoResult = {} as QuickInfoResult;
   try {
      result = await getQuickInfo(file, offset);
   } catch (e) {
      console.log(e);
   }
   if (!result.displayParts) {
      result = {
         kind: 'aliasName',
         displayParts: [
            {
               text:
                  (await onExpandedSelection(
                     { fileName: file, position: namePosition },
                     getRangeText
                  )) ?? 'ERROR_GETTING_TYPE_CODE',
               kind: 'full type',
            },
         ],
      };
   }

   const name = textEditor.document
      .getText(
         new vscode.Range(
            namePosition,
            new vscode.Position(namePosition.line + 1, 0)
         )
      )
      .replace(/\s|=|{.*/, ''); // textEditor.document.getText().slice(start, start + length);

   ({ result, namePosition } = await interfaceToType(
      extract.interfaces2types,
      result.kind,
      textEditor,
      namePosition,
      name,
      file
   ));

   result.position = namePosition;
   result.fileName = file;

   const types = new Map([[name, result]]);
   await resolveTypeDeps(
      extract.interfaces2types,
      types,
      result,
      textEditor,
      namePosition
   );

   const code = Array.from(types.values())
      .reverse()
      .map((info) => info.displayParts.map((p) => p.text).join(''))
      .join('\n\n');

   const newCode = extractions[extract.extraction].transform(code);

   if (extract.commentOldTypes) {
      await commentOldTypes(types);
   }

   if (extract.target === 'inplace') {
      // for some reason vscode thinks the textEditor is closed
      const openEditor = await vscode.window.showTextDocument(
         textEditor.document
      );
      await openEditor.edit(
         (edit) => {
            edit.insert(
               new vscode.Position(namePosition.line, 0),
               `// name: ${name}\n${newCode}\n`
            );
         },
         { undoStopAfter: false, undoStopBefore: false }
      );
   }

   if (extract.target === 'clipboard') {
      vscode.env.clipboard.writeText(newCode);
      vscode.window.showInformationMessage('Result written to clipboard');
   }

   if (extract.target === 'newDocument') {
      const document = await vscode.workspace.openTextDocument({
         language: extract.language,
      });
      const editor = await vscode.window.showTextDocument(document);
      await editor.edit((edit) =>
         edit.insert(new vscode.Position(0, 0), newCode)
      );
   }

   if (extract.autoUndo) {
      undoStack.restore();
   }
}
