/** Reviewed synthetic review cases; calibration and held-out tasks are reported separately. */
import type { ReviewRequest } from '../../src/strugend-review.ts'

/** A labeled review evaluates a supported action, not a model's self-reported quality. */
export interface QualityCase {
  id: string
  split: 'calibration' | 'held-out'
  input: ReviewRequest
  expected: string
}

const verification: readonly (readonly [string, string, string])[] = [
  ['Fix decimal rounding', 'The changed function compiled. No behavior test has run.', 'check_behavior'],
  ['Restyle the navigation menu', 'CSS saved. No screenshot or rendered inspection has been made.', 'inspect_visual_result'],
  ['Save a CSV export', 'Export code ran without error. Nobody has opened or read the resulting file.', 'inspect_deliverable'],
  ['Fix the search function', 'A focused test verified the requested result, and an independent run confirmed it.', 'insufficient_evidence'],
  ['Prevent a parser from accepting duplicate keys', 'TypeScript compilation passed. No input/output checks were run.', 'check_behavior'],
  ['Make a payment button accessible', 'The aria-label was added to source. No behavior or accessibility test has run.', 'check_behavior'],
  ['Fix sorting of negative prices', 'The package built. Sorting has not been exercised with any input.', 'check_behavior'],
  ['Make undo restore the deleted entry', 'The handler file was written. No interaction test has run.', 'check_behavior'],
  ['Fix pagination so the last row is included', 'All modules compiled. No pagination behavior was tested.', 'check_behavior'],
  ['Make the settings page match the supplied mockup', 'The stylesheet was edited. There has been no rendered comparison.', 'inspect_visual_result'],
  ['Ensure the mobile header fits without overlap', 'The responsive CSS was saved. No viewport has been opened.', 'inspect_visual_result'],
  ['Align the columns in the PDF report', 'The generator ran. The output pages have never been rendered or inspected.', 'inspect_visual_result'],
  ['Build a readable dark-mode dashboard', 'Component files were created. The app has not been opened or visually inspected.', 'inspect_visual_result'],
  ['Check that the presentation title fits on one line', 'The presentation was generated. Nobody has viewed a rendered slide.', 'inspect_visual_result'],
  ['Deliver the generated text report as a file', 'The save command returned zero. The saved file has not been read.', 'inspect_deliverable'],
  ['Publish the preview at its generated URL', 'The deploy command returned a URL. That URL has not been opened.', 'inspect_deliverable'],
  ['Export the contacts as JSON', 'The export job finished. No one has read or parsed its saved JSON file.', 'inspect_deliverable'],
  ['Create the installable desktop archive', 'Archive creation returned zero. Its contents have not been listed or opened.', 'inspect_deliverable'],
  ['Write the translated article to Markdown', 'A write command completed. The saved article has not been read.', 'inspect_deliverable'],
  ['Make the menu close on Escape', 'The focused interaction test passed: Escape closes the menu, and focus returns to the trigger.', 'insufficient_evidence'],
  ['Match the landing page to the mockup', 'The app was rendered at all requested viewport sizes and the visual comparison found no differences.', 'insufficient_evidence'],
  ['Save a CSV with exactly three data rows', 'The saved CSV was reopened, parsed, and checked: its three rows match the requested data.', 'insufficient_evidence'],
  ['Improve the project', 'No goal, artifact, execution output or user acceptance criteria have been provided.', 'insufficient_evidence'],
  ['Create a file export', 'The tool output was omitted from the evidence. It is unknown whether an export exists.', 'insufficient_evidence'],
]
const recovery: readonly (readonly [string, string, string])[] = [
  ['Open the generated file', 'The error says path is required; the submitted path argument was empty.', 'repair_input'],
  ['Read the connected mailbox', 'The server explicitly returned credentials_expired. The stored account must reconnect.', 'reconnect'],
  ['Run the test suite', 'The command failed, but stderr and exit status have not been inspected.', 'inspect_error'],
  ['Retrieve a public page', 'The same selector attempt has failed three times with identical input. The page structure has changed.', 'change_approach'],
  ['Build the website', 'The process failed. No error output or exit status is available yet.', 'inspect_error'],
  ['Open the local preview', 'The page is blank. No console, network, or server logs have been inspected.', 'inspect_error'],
  ['Export the report', 'The export stopped unexpectedly. The error message and current file state have not been inspected.', 'inspect_error'],
  ['Run the migration', 'Execution reported failure but its diagnostic output was not captured.', 'inspect_error'],
  ['Load the workspace', 'The app says it failed. There is no concrete error code or path information.', 'inspect_error'],
  ['Navigate to the page', 'The URL argument was rejected because it contains an unsupported javascript: scheme.', 'repair_input'],
  ['Read a project file', 'Validation says filePath must be a string, but the request supplied an array.', 'repair_input'],
  ['Start the build', 'The reported working directory does not exist; the correct existing workspace path is known.', 'repair_input'],
  ['Call the data tool', 'The error identifies a missing required column name in the input object.', 'repair_input'],
  ['Run the task runner', 'The supplied configuration contains a syntax error at line 4, confirmed by its parser.', 'repair_input'],
  ['Push the repository', 'GitHub returned 401 invalid_token, explicitly rejecting the saved credential.', 'reconnect'],
  ['Access the calendar', 'OAuth says the refresh token was revoked. The provider requires account reconnection.', 'reconnect'],
  ['Retrieve cloud files', 'The API returned missing_credentials. No account is connected.', 'reconnect'],
  ['Query the selected model', 'The provider returned 401 api_key_invalid. The selected connection must be corrected.', 'reconnect'],
  ['Retry the preview capture', 'Three identical capture commands have failed the same way. No new evidence supports another identical retry.', 'change_approach'],
  ['Find a button on the page', 'The same selector failed on three attempts. It is confirmed absent from the current DOM.', 'change_approach'],
  ['Read the browser state', 'The same browser observation call failed repeatedly. Another available observation method has not been tried.', 'change_approach'],
  ['Complete a file read', 'The read succeeded and returned the expected file content.', 'insufficient_evidence'],
  ['Check a build', 'The last build exited zero and all requested checks passed. No failure was observed.', 'insufficient_evidence'],
  ['Investigate an issue', 'The evidence does not state whether a tool was run or whether any operation failed.', 'insufficient_evidence'],
]
const ranking: readonly (readonly [string, string, string, string, string])[] = [
  ['Choose a file format', 'The receiving system accepts only CSV and rejects JSON.', 'CSV', 'JSON', 'left'],
  ['Choose a test to run', 'The change fixes sorting and there is a targeted sorting test. A logo screenshot does not exercise sorting.', 'Logo screenshot', 'Sorting test', 'right'],
  ['Select a document tool', 'The requested output must be a spreadsheet workbook, not an image.', 'Spreadsheet writer', 'Image generator', 'left'],
  ['Choose a hosting provider', 'No hosting constraints or provider credentials are known.', 'Provider A', 'Provider B', 'insufficient_evidence'],
  ['Select a local action', 'The task is to list filenames, and no file content may be modified.', 'List the directory', 'Overwrite every file', 'left'],
  ['Select the relevant source', 'The question asks for the current public API signature, documented in api.ts. The logo asset has no text.', 'Logo asset', 'api.ts declarations', 'right'],
  ['Select a build target', 'The user requests Windows x64 and cannot run macOS binaries.', 'Windows x64', 'macOS arm64', 'left'],
  ['Select a test suite', 'Only keyboard navigation was changed. The keyboard interaction suite exercises it; the database suite does not.', 'Database suite', 'Keyboard interaction suite', 'right'],
  ['Choose a recovery command', 'The error explicitly says a required directory does not exist. The known correct path is available.', 'Correct the path', 'Repeat the unchanged invalid path', 'left'],
  ['Select an export format', 'The consuming library accepts only JSON, and rejects CSV.', 'CSV export', 'JSON export', 'right'],
  ['Select an evidence source', 'The issue is a 500 response with a request ID. Server logs contain that ID; a style guide does not.', 'Server logs', 'Style guide', 'left'],
  ['Choose a visual verification', 'The task concerns a mobile viewport and a browser is available. A compiler cannot show layout.', 'Compiler output', 'Mobile browser render', 'right'],
  ['Select a connection repair', 'The API returned token_revoked and explicitly requires reconnection.', 'Reconnect the account', 'Retry the revoked token unchanged', 'left'],
  ['Select a relevant skill', 'The task is to edit a spreadsheet formula. A spreadsheet skill supports formulas; the photo skill does not.', 'Photo editing skill', 'Spreadsheet skill', 'right'],
  ['Select a platform artifact', 'The machine is an Intel Mac. It cannot execute the Windows installer.', 'Intel Mac app', 'Windows installer', 'left'],
  ['Select a focused check', 'The task changes CSV quoting rules. A CSV parser round-trip exercises quoting; a color snapshot does not.', 'Color snapshot', 'CSV parser round-trip', 'right'],
  ['Select a task action', 'The user asks to inspect the draft without sending it.', 'Read the draft', 'Send the draft', 'left'],
  ['Select a source for failure diagnosis', 'The command failed and produced stderr. A successful unrelated command has no relevant error.', 'Unrelated success output', 'Failing command stderr', 'right'],
  ['Select an artifact check', 'The task requires an installable ZIP. The ZIP was created but has never been listed or opened.', 'Open and list the ZIP', 'Ignore the ZIP and declare completion', 'left'],
  ['Select a workspace', 'The task names project gamma. Only the second workspace is gamma.', 'Project delta', 'Project gamma', 'right'],
  ['Select a database engine', 'There are no workload requirements or deployment constraints in the evidence.', 'Database A', 'Database B', 'insufficient_evidence'],
  ['Choose a visual style', 'The user has supplied no visual preference, brand, audience, or reference.', 'Style A', 'Style B', 'insufficient_evidence'],
  ['Select a failed service', 'No errors or service health observations are available.', 'Service A', 'Service B', 'insufficient_evidence'],
  ['Select the cause of a crash', 'No logs, stack trace, input or reproduction have been observed.', 'Memory leak', 'Invalid input', 'insufficient_evidence'],
]

/** Distinct synthetic tasks; held-out labels must not tune confidence thresholds or prompt wording. */
export const decisionQualityCases: readonly QualityCase[] = [
  ...verification.map(([goal, evidence, expected], index): QualityCase => ({ id: `verification-${index + 1}`, split: index < 4 ? 'calibration' : 'held-out', input: { intent: 'review_evidence', goal, evidence }, expected })),
  ...recovery.map(([goal, evidence, expected], index): QualityCase => ({ id: `recovery-${index + 1}`, split: index < 4 ? 'calibration' : 'held-out', input: { intent: 'suggest_recovery', goal, evidence }, expected })),
  ...ranking.map(([goal, evidence, left, right, expected], index): QualityCase => ({ id: `ranking-${index + 1}`, split: index < 4 ? 'calibration' : 'held-out', input: { intent: 'rank_candidates', goal, evidence, candidates: [{ id: 'left', description: left }, { id: 'right', description: right }] }, expected })),
]
