/*
 * v0 preview mock data. Shapes follow the vault contracts (C2 health snapshot,
 * C3 edges, C5 errors, C6 tests) so wiring the real API later is a swap, not a
 * rewrite. Everything here is fabricated for the look-and-feel preview.
 */

export interface DimensionScore {
  key: 'errors' | 'dependencies' | 'tests' | 'structure';
  label: string;
  score: number;
  delta: number;
  detail: string;
  trend: number[];
}

export const program = {
  name: 'lexpro-portal',
  importedAt: '2026-07-16 14:20',
  filesAnalysed: 1842,
};

export const overallScore = { score: 63, delta: +4 };

export const dimensions: DimensionScore[] = [
  {
    key: 'errors',
    label: 'Errors',
    score: 55,
    delta: -3,
    detail: '12 errors, 31 warnings, 2 chains',
    trend: [61, 62, 60, 58, 59, 57, 60, 58, 56, 58, 57, 55],
  },
  {
    key: 'dependencies',
    label: 'Dependencies',
    score: 48,
    delta: +6,
    detail: '3 missing, 14 outdated, 2 env vars undeclared',
    trend: [40, 40, 41, 43, 42, 44, 43, 45, 44, 46, 47, 48],
  },
  {
    key: 'tests',
    label: 'Tests',
    score: 71,
    delta: +9,
    detail: '17 of 21 runs passing (81%)',
    trend: [52, 55, 58, 57, 60, 62, 61, 64, 66, 68, 70, 71],
  },
  {
    key: 'structure',
    label: 'Structure',
    score: 78,
    delta: 0,
    detail: '4 hotspot files, 2 orphans',
    trend: [77, 78, 78, 77, 79, 78, 78, 79, 78, 78, 78, 78],
  },
];

export const overallTrend = [56, 57, 57, 56, 58, 58, 59, 60, 60, 61, 62, 63];
export const trendWeeks = [
  'May 4', 'May 11', 'May 18', 'May 25', 'Jun 1', 'Jun 8',
  'Jun 15', 'Jun 22', 'Jun 29', 'Jul 6', 'Jul 13', 'Jul 16',
];

export interface TopIssue {
  dimension: DimensionScore['key'];
  severity: 'critical' | 'serious' | 'warning';
  summary: string;
  ref: string;
}

export const topIssues: TopIssue[] = [
  { dimension: 'errors', severity: 'critical', summary: 'Nullable invoice passed unchecked into PaymentService::capture()', ref: 'app/Services/PaymentService.php:48' },
  { dimension: 'dependencies', severity: 'serious', summary: 'guzzlehttp/guzzle used but missing from composer.json', ref: 'composer.json' },
  { dimension: 'errors', severity: 'serious', summary: 'Route "statements.export" points at a removed controller method', ref: 'routes/web.php:61' },
  { dimension: 'tests', severity: 'warning', summary: '"Create invoice" failing for 3 consecutive runs', ref: 'tests/Browser/CreateInvoice' },
  { dimension: 'dependencies', severity: 'warning', summary: 'MAIL_WEBHOOK_SECRET read in code, absent from .env.example', ref: 'app/Http/Controllers/WebhookController.php:22' },
];

export const hotspots = [
  { file: 'app/Services/PaymentService.php', centrality: 0.91, errorDensity: 0.62 },
  { file: 'app/Models/Invoice.php', centrality: 0.84, errorDensity: 0.35 },
  { file: 'routes/web.php', centrality: 0.77, errorDensity: 0.31 },
  { file: 'app/Http/Controllers/StatementController.php', centrality: 0.52, errorDensity: 0.44 },
];

/* ---------- Explore: folders, tree, graph ---------- */

export const folders = [
  { name: 'app', series: 1 },
  { name: 'routes', series: 2 },
  { name: 'resources', series: 3 },
  { name: 'database', series: 4 },
  { name: 'other', series: 0 },
] as const;

export interface GraphNode {
  id: string;
  label: string;
  folder: (typeof folders)[number]['name'];
  x: number;
  y: number;
  inDegree: number;
  errors: number;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export const graphNodes: GraphNode[] = [
  { id: 'payment', label: 'PaymentService.php', folder: 'app', x: 430, y: 190, inDegree: 9, errors: 3 },
  { id: 'invoice', label: 'Invoice.php', folder: 'app', x: 320, y: 120, inDegree: 7, errors: 1 },
  { id: 'tenant', label: 'Tenant.php', folder: 'app', x: 250, y: 210, inDegree: 5, errors: 0 },
  { id: 'statementCtl', label: 'StatementController.php', folder: 'app', x: 520, y: 110, inDegree: 4, errors: 2 },
  { id: 'invoiceCtl', label: 'InvoiceController.php', folder: 'app', x: 405, y: 70, inDegree: 3, errors: 0 },
  { id: 'webhookCtl', label: 'WebhookController.php', folder: 'app', x: 560, y: 250, inDegree: 2, errors: 1 },
  { id: 'ledger', label: 'LedgerService.php', folder: 'app', x: 335, y: 285, inDegree: 4, errors: 0 },
  { id: 'web', label: 'web.php', folder: 'routes', x: 640, y: 150, inDegree: 6, errors: 1 },
  { id: 'api', label: 'api.php', folder: 'routes', x: 690, y: 260, inDegree: 3, errors: 0 },
  { id: 'appJs', label: 'app.js', folder: 'resources', x: 790, y: 120, inDegree: 2, errors: 0 },
  { id: 'invoiceVue', label: 'InvoiceForm.vue', folder: 'resources', x: 860, y: 210, inDegree: 2, errors: 0 },
  { id: 'statementVue', label: 'StatementTable.vue', folder: 'resources', x: 800, y: 310, inDegree: 1, errors: 0 },
  { id: 'migInv', label: '2024_create_invoices.php', folder: 'database', x: 180, y: 330, inDegree: 1, errors: 0 },
  { id: 'migTen', label: '2023_create_tenants.php', folder: 'database', x: 120, y: 250, inDegree: 1, errors: 0 },
  { id: 'envEx', label: '.env.example', folder: 'other', x: 520, y: 360, inDegree: 2, errors: 1 },
  { id: 'composer', label: 'composer.json', folder: 'other', x: 640, y: 400, inDegree: 3, errors: 1 },
];

export const graphEdges: GraphEdge[] = [
  { from: 'invoiceCtl', to: 'invoice' },
  { from: 'invoiceCtl', to: 'payment' },
  { from: 'statementCtl', to: 'payment' },
  { from: 'statementCtl', to: 'tenant' },
  { from: 'webhookCtl', to: 'payment' },
  { from: 'payment', to: 'invoice' },
  { from: 'payment', to: 'ledger' },
  { from: 'ledger', to: 'tenant' },
  { from: 'web', to: 'invoiceCtl' },
  { from: 'web', to: 'statementCtl' },
  { from: 'api', to: 'webhookCtl' },
  { from: 'appJs', to: 'invoiceVue' },
  { from: 'appJs', to: 'statementVue' },
  { from: 'invoice', to: 'migInv' },
  { from: 'tenant', to: 'migTen' },
  { from: 'webhookCtl', to: 'envEx' },
  { from: 'payment', to: 'composer' },
  { from: 'web', to: 'appJs' },
];

export interface TreeItem {
  path: string;
  depth: number;
  folder: (typeof folders)[number]['name'];
  isDir: boolean;
  links: number;
  errors: number;
}

export const tree: TreeItem[] = [
  { path: 'app/', depth: 0, folder: 'app', isDir: true, links: 34, errors: 7 },
  { path: 'Http/Controllers/', depth: 1, folder: 'app', isDir: true, links: 15, errors: 3 },
  { path: 'InvoiceController.php', depth: 2, folder: 'app', isDir: false, links: 5, errors: 0 },
  { path: 'StatementController.php', depth: 2, folder: 'app', isDir: false, links: 6, errors: 2 },
  { path: 'WebhookController.php', depth: 2, folder: 'app', isDir: false, links: 4, errors: 1 },
  { path: 'Models/', depth: 1, folder: 'app', isDir: true, links: 12, errors: 1 },
  { path: 'Invoice.php', depth: 2, folder: 'app', isDir: false, links: 8, errors: 1 },
  { path: 'Tenant.php', depth: 2, folder: 'app', isDir: false, links: 6, errors: 0 },
  { path: 'Services/', depth: 1, folder: 'app', isDir: true, links: 13, errors: 3 },
  { path: 'PaymentService.php', depth: 2, folder: 'app', isDir: false, links: 11, errors: 3 },
  { path: 'LedgerService.php', depth: 2, folder: 'app', isDir: false, links: 5, errors: 0 },
  { path: 'routes/', depth: 0, folder: 'routes', isDir: true, links: 9, errors: 1 },
  { path: 'web.php', depth: 1, folder: 'routes', isDir: false, links: 7, errors: 1 },
  { path: 'api.php', depth: 1, folder: 'routes', isDir: false, links: 3, errors: 0 },
  { path: 'resources/js/', depth: 0, folder: 'resources', isDir: true, links: 5, errors: 0 },
  { path: 'database/migrations/', depth: 0, folder: 'database', isDir: true, links: 2, errors: 0 },
  { path: 'composer.json', depth: 0, folder: 'other', isDir: false, links: 3, errors: 1 },
];

/* ---------- Diagnose ---------- */

export interface ErrorChain {
  id: string;
  kind: string;
  severity: 'critical' | 'serious' | 'warning';
  rootFile: string;
  rootLine: number;
  summary: string;
  explanation: string;
  affected: string[];
  upstream: string[];
}

export const chains: ErrorChain[] = [
  {
    id: 'chain-1',
    kind: 'null-risk',
    severity: 'critical',
    rootFile: 'app/Services/PaymentService.php',
    rootLine: 48,
    summary: 'Nullable invoice reaches capture() unchecked',
    explanation:
      'Invoice::find() can return null, and capture() dereferences it. Expect intermittent "call to a member function on null" at runtime whenever a stale invoice id arrives from the queue.',
    affected: [
      'app/Http/Controllers/InvoiceController.php',
      'app/Http/Controllers/StatementController.php',
      'app/Services/LedgerService.php',
    ],
    upstream: ['app/Models/Invoice.php'],
  },
  {
    id: 'chain-2',
    kind: 'contract-mismatch',
    severity: 'serious',
    rootFile: 'routes/web.php',
    rootLine: 61,
    summary: 'Route "statements.export" targets a removed method',
    explanation:
      'StatementController::export() was deleted but the route still points at it. Every request to this route 500s.',
    affected: ['resources/js/StatementTable.vue'],
    upstream: ['app/Http/Controllers/StatementController.php'],
  },
];

export const codeSnippet: { line: number; text: string }[] = [
  { line: 43, text: 'public function capture(int $invoiceId): Receipt' },
  { line: 44, text: '{' },
  { line: 45, text: '    $invoice = Invoice::find($invoiceId);' },
  { line: 46, text: '' },
  { line: 47, text: '    // charge the tenant on file' },
  { line: 48, text: '    $charge = $this->gateway->charge(' },
  { line: 49, text: '        $invoice->tenant->paymentToken,' },
  { line: 50, text: '        $invoice->totalCents(),' },
  { line: 51, text: '    );' },
  { line: 52, text: '' },
  { line: 53, text: '    return $this->ledger->record($invoice, $charge);' },
  { line: 54, text: '}' },
];

export const highlightedLines = [48, 49, 50];

/* ---------- Tests ---------- */

export interface BrowserTest {
  id: string;
  name: string;
  steps: { action: string; target: string; value?: string }[];
  runs: ('pass' | 'fail')[];
  lastRun: string;
}

export const tests: BrowserTest[] = [
  {
    id: 't1',
    name: 'Login flow',
    steps: [
      { action: 'navigate', target: '/login' },
      { action: 'fill', target: 'input[name=email]', value: 'agent@lexpro.test' },
      { action: 'fill', target: 'input[name=password]', value: '••••••••' },
      { action: 'click', target: 'role=button[name="Sign in"]' },
      { action: 'expectVisible', target: '[data-testid=dashboard]' },
    ],
    runs: ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass'],
    lastRun: '2026-07-16 18:02',
  },
  {
    id: 't2',
    name: 'Create invoice',
    steps: [
      { action: 'navigate', target: '/invoices/new' },
      { action: 'fill', target: 'role=textbox[name="Tenant"]', value: 'Daniel T.' },
      { action: 'fill', target: 'role=textbox[name="Amount"]', value: '1250.00' },
      { action: 'click', target: 'role=button[name="Create"]' },
      { action: 'expectText', target: '.toast', value: 'Invoice created' },
    ],
    runs: ['pass', 'pass', 'pass', 'pass', 'fail', 'fail', 'fail'],
    lastRun: '2026-07-16 18:05',
  },
  {
    id: 't3',
    name: 'Tenant statement export',
    steps: [
      { action: 'navigate', target: '/statements' },
      { action: 'click', target: 'role=button[name="Export"]' },
      { action: 'expectVisible', target: '.download-ready' },
    ],
    runs: ['pass', 'fail', 'pass', 'pass', 'pass', 'pass', 'pass'],
    lastRun: '2026-07-16 18:07',
  },
];

/* ---------- Settings ---------- */

export const targetEnv = {
  name: 'staging',
  baseUrl: 'https://staging.lexpro-portal.internal',
  notes: 'Reachable on office VPN only',
};
