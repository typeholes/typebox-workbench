import { Kind } from '@sinclair/typebox';
import * as vscode from 'vscode';
import { undoStack } from './undoStack';

export type QuickInfoResult = {
   displayParts: { text: string; kind: string }[];
   kind: string;
   position?: vscode.Position;
   fileName?: string;
};

export async function getQuickInfo(file: string, offset: number) {
   return (
      (await vscode.commands.executeCommand(
         'typescript.tsserverRequest',
         'quickinfo-full',
         { file, position: offset }
      )) as { body: QuickInfoResult }
   ).body;
}

const keywords = ['export', 'type', 'interface'];

export async function resolveTypeDeps(
   transformInterfaces: boolean,
   types: Map<string, QuickInfoResult>,
   info: QuickInfoResult,
   editor: vscode.TextEditor,
   position: vscode.Position
) {
   const arr =
      info.displayParts[0].kind === 'full type'
         ? info.displayParts[0].text
              .split(/(\s|[^[A-Za-z_0-9$_]+)/)
              .filter(
                 (x, i, xs) =>
                    !keywords.includes(x) &&
                    x.match(/^[A-Za-z_0-9$_]+$/) &&
                    !(xs[i + 1] ?? '').match(/^\s*:/)
              )
              .map((x) => ({ text: x, kind: 'aliasName' }))
         : info.displayParts.filter(
              (p) => p.kind === 'aliasName' || p.kind === 'interfaceName'
           );

   for (const alias of arr) {
      if (!types.has(alias.text)) {
         console.log(alias.text);
         const defOffset = getOffsetOf(
            editor.document,
            position,
            alias.text,
            'ignoreError'
         );
         const definitions =
            defOffset === 1
               ? undefined
               : ((await vscode.commands.executeCommand(
                    'vscode.executeDefinitionProvider',
                    editor.document.uri,
                    editor.document.positionAt(defOffset)
                 )) as Array<vscode.Location | vscode.LocationLink>);
         if (definitions && definitions.length > 0) {
            const def = definitions[0];
            const [defUri, defRange] =
               def instanceof vscode.Location
                  ? [def.uri, def.range]
                  : [
                       def.targetUri,
                       def.targetSelectionRange ?? def.targetRange,
                    ];
            const defDocument = await vscode.workspace.openTextDocument(defUri);
            const defEditor = await vscode.window.showTextDocument(
               defDocument
               // { preserveFocus: true }
            );
            // const defOffset = getOffsetOf(
            //    defDocument,
            //    defRange.start,
            //    alias.text
            // );

            const file = defDocument.fileName;

            const { result, namePosition } = await interfaceToType(
               transformInterfaces,
               alias.kind,
               defEditor,
               defRange.start,
               alias.text,
               file
            );

            result.position = namePosition;
            result.fileName = defDocument.fileName;

            types.set(alias.text, result);
            await resolveTypeDeps(
               transformInterfaces,
               types,
               result,
               defEditor,
               namePosition
            );
         }
      }
   }
}

export function getInterfaceKeywordOffset(
   document: vscode.TextDocument,
   position: vscode.Position
) {
   const offset = document.offsetAt(position);
   const text = document.getText().slice(0, offset);
   const match = text.match(/\binterface\b\s+/);
   if (!match) {
      throw new Error(`interface keyword not found`);
   }

   const delta = match[0].length;
   return offset - delta;
}

export function getOffsetOf(
   document: vscode.TextDocument,
   position: vscode.Position,
   name: string,
   ignoreError: 'ignoreError' | undefined = undefined
) {
   const offset = document.offsetAt(position);
   const text = document.getText().slice(offset);
   const match = text.match(new RegExp(`^(.*)\\b${name}\\b`, 's'));
   if (!match) {
      if (ignoreError === undefined) {
         throw new Error(`alias text not found: ${name}`);
      }
      console.log(`alias text not found: ${name}`);
      return -1;
   }

   const delta = match[0].length;
   return offset + delta;
}

export async function commentOldTypes(types: Map<string, QuickInfoResult>) {
   for (const result of types.values()) {
      await onExpandedSelection(result, commentRange);
   }
}

export async function onExpandedSelection(
   result: {
      fileName?: string;
      position?: vscode.Position;
   },
   action: (
      editor: vscode.TextEditor,
      range: vscode.SelectionRange,
      document: vscode.TextDocument
   ) => Promise<string>
) {
   if (result.fileName && result.position) {
      const document = await vscode.workspace.openTextDocument(result.fileName);
      undoStack.registerChange(document);

      const editor = await vscode.window.showTextDocument(document);
      editor.selection = new vscode.Selection(result.position, result.position);
      const ranges = await vscode.commands.executeCommand<
         vscode.SelectionRange[]
      >('vscode.executeSelectionRangeProvider', document.uri, [
         result.position,
      ]);
      if (ranges?.length > 0) {
         let range = ranges[0];
         while (
            range.parent &&
            // !(range.parent?.parent?.parent === undefined) &&
            !(
               range.parent.range.start.line === 0 &&
               range.parent?.range.end.line === document.lineCount - 1
            )
         ) {
            if (
               range.parent.range.start.line === 0 &&
               range.parent.range.start.character === 0
            ) {
               const offset = document.offsetAt(range.parent.range.end);
               const remaining = document.getText().slice(offset);
               if (!remaining.match(/\S/)) {
                  break;
               }
            }
            range = range.parent;
            editor.selection = new vscode.Selection(
               range.range.start,
               range.range.end
            );
         }
         if (range) {
            return await action(editor, range, document);
         }
      }
   }
}

async function commentRange(
   editor: vscode.TextEditor,
   range: vscode.SelectionRange,
   document: vscode.TextDocument
) {
   editor.selection = new vscode.Selection(range.range.start, range.range.end);
   try {
      await vscode.commands.executeCommand('editor.action.addCommentLine');
   } catch (e) {
      console.log(`failed to comment (${document.fileName}): ${e}`);
   }
   return 'commented';
}

export async function interfaceToType(
   doTransform: boolean,
   kind: string,
   textEditor: vscode.TextEditor,
   namePosition: vscode.Position,
   name: string,
   file: string
) {
   if (doTransform && kind.startsWith('interface')) {
      const interfaceOffset = getInterfaceKeywordOffset(
         textEditor.document,
         namePosition
      );
      const interfacePosition = textEditor.document.positionAt(interfaceOffset);
      const endPosition = new vscode.Position(
         namePosition.line,
         namePosition.character + name.length
      );
      const interfaceRange = new vscode.Range(interfacePosition, endPosition);

      undoStack.registerChange(textEditor.document);
      // for some reason vscode thinks the textEditor is closed
      const openEditor = await vscode.window.showTextDocument(
         textEditor.document
      );

      try {
         await openEditor.edit(
            (edit) => edit.replace(interfaceRange, `type ${name} =`),
            { undoStopAfter: false, undoStopBefore: false }
         );
         console.log(`changed interface to type: ${name}`);

         const newNameOffset = interfaceOffset + 5;

         const result = await getQuickInfo(file, newNameOffset);
         namePosition = textEditor.document.positionAt(newNameOffset);
         return { result, namePosition };
      } catch (e) {
         console.log('failed to change interface to type (${file}): ${e}');
      }
   }
   let result: QuickInfoResult = {} as QuickInfoResult;
   try {
      result = await getQuickInfo(
         file,
         textEditor.document.offsetAt(namePosition)
      );
   } catch (e) {
      console.log(e);
   }
   if (!result.displayParts) {
      result = {
         kind: 'aliasName',
         position: namePosition,
         fileName: file,
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
   return { result, namePosition };
}

export function select<K extends string>(
   keys: K[],
   obj: Record<string, any>
): Record<K, string> {
   return Object.fromEntries(keys.map((k) => [k, obj[k]])) as never;
}

export function omit(
   keys: PropertyKey[],
   obj: Record<string, any>
): Record<PropertyKey, any> {
   return Object.fromEntries(
      Object.entries(obj).filter((e) => !keys.includes(e[0]))
   );
}

export function getRangeText(
   editor: vscode.TextEditor,
   range: vscode.SelectionRange,
   document: vscode.TextDocument
): Promise<string> {
   return Promise.resolve(document.getText(range.range));
}
