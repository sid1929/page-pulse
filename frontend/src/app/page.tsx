
"use client";

import { useEffect, useState } from "react";
import { scanWebsite } from "@/lib/api";
import jsPDF from "jspdf";


type ScanReport = {
  url: string;
  auditedAt: string;
  riskAssessment?: {
    score: number | null;
    riskLevel: string;
  };
  findings?: {
    summary: {
      total: number;
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    findings: Array<{
      id: string;
      title: string;
      severity: string;
      category: string;
      description: string;
      impact: string;
      remediation: string;
    }>;
  };
  securityHeaders?: {
    score: number;
    total: number;
    passed: number;
    missing: number;
  };
  cookieAnalysis?: {
    total: number;
    secureCookies: number;
    insecureCookies: number;
    score: number | null;
  };
  tls?: {
    protocol?: string;
    authorized?: boolean;
    authorizationError?: string | null;
  } | null;
  status?: {
    code: number;
    ok: boolean;
    redirected: boolean;
    finalUrl: string;
  };
  performance?: {
    responseTimeMs?: number;
  };
};


const navigation = [
  { name: "Overview", icon: "◫" },
  { name: "New Scan", icon: "⌕" },
  { name: "Scan History", icon: "◷" },
  { name: "Reports", icon: "▤" },
];

const features = [
  {
    number: "01",
    title: "Security Headers",
    description: "Review HTTP security headers and identify missing protections.",
    icon: "⬡",
  },
  {
    number: "02",
    title: "Cookie Analysis",
    description: "Inspect Secure, HttpOnly, SameSite and cookie configurations.",
    icon: "◈",
  },
  {
    number: "03",
    title: "TLS Assessment",
    description: "Review HTTPS connectivity and certificate validity.",
    icon: "⌑",
  },
];

export default function Home() {
  const [active, setActive] = useState("Overview");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");

  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
const [isScanning, setIsScanning] = useState(false);
const [scanHistory, setScanHistory] = useState<ScanReport[]>([]);
const [historySearch, setHistorySearch] = useState("");
const [riskFilter, setRiskFilter] = useState("All");
const [historySort, setHistorySort] = useState("Newest");

const filteredHistory = scanHistory
  .filter((scan) =>
    scan.url.toLowerCase().includes(historySearch.toLowerCase())
  )
  .filter((scan) =>
    riskFilter === "All" ||
    scan.riskAssessment?.riskLevel === riskFilter
  )
  .sort((a, b) =>
    historySort === "Newest"
      ? new Date(b.auditedAt).getTime() - new Date(a.auditedAt).getTime()
      : new Date(a.auditedAt).getTime() - new Date(b.auditedAt).getTime()
  );

const [compareMode, setCompareMode] = useState(false);
const [previousScan, setPreviousScan] = useState<ScanReport | null>(null);
const [currentScan, setCurrentScan] = useState<ScanReport | null>(null);
const severityStats = scanHistory.reduce(
  (totals, scan) => ({
    critical: totals.critical + (scan.findings?.summary.critical ?? 0),
    high: totals.high + (scan.findings?.summary.high ?? 0),
    medium: totals.medium + (scan.findings?.summary.medium ?? 0),
    low: totals.low + (scan.findings?.summary.low ?? 0),
  }),
  { critical: 0, high: 0, medium: 0, low: 0 }
);

const totalSeverityFindings =
  severityStats.critical +
  severityStats.high +
  severityStats.medium +
  severityStats.low;

useEffect(() => {
  const savedHistory = localStorage.getItem("page-pulse-history");

  if (savedHistory) {
    try {
      setScanHistory(JSON.parse(savedHistory));
    } catch {
      localStorage.removeItem("page-pulse-history");
    }
  }
}, []);



async function handleScan(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();

  setIsScanning(true);
  setMessage("Scanning website...");
  setScanReport(null);

  try {
    const data = await scanWebsite(url);

    setScanReport(data.result);

    const updatedHistory = [
  data.result,
  ...scanHistory,
].slice(0, 10);

setScanHistory(updatedHistory);

localStorage.setItem(
  "page-pulse-history",
  JSON.stringify(updatedHistory)
);
    setMessage("Security scan completed successfully!");

    console.log("Page Pulse scan result:", data);
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : "Unable to complete the scan."
    );
  } finally {
    setIsScanning(false);
  }
}



function downloadPdfReport() {
  if (!scanReport) return;

  const doc = new jsPDF();
  const reportId = `PP-${Date.now().toString(36).toUpperCase()}`;
const generatedAt = new Date().toLocaleString();
  let y = 20;

  const summary = scanReport.findings?.summary;
  const riskLevel = scanReport.riskAssessment?.riskLevel ?? "Unknown";
  const riskScore = scanReport.riskAssessment?.score ?? "N/A";

  const riskColors: Record<string, [number, number, number]> = {
    Critical: [220, 38, 38],
    High: [234, 88, 12],
    Medium: [202, 138, 4],
    Low: [22, 163, 74],
  };

  const riskColor = riskColors[riskLevel] ?? [100, 116, 139];

  function addText(
    text: string,
    fontSize = 10,
    bold = false,
    color: [number, number, number] = [50, 60, 75]
  ) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);

    const lines = doc.splitTextToSize(text, 175);
    const lineHeight = fontSize * 0.5 + 2;

    if (y + lines.length * lineHeight > 275) {
      doc.addPage();
      y = 20;
    }

    doc.text(lines, 17, y);
    y += lines.length * lineHeight + 4;
  }

  function addSection(title: string) {
    y += 5;
    doc.setFillColor(230, 245, 250);
    doc.roundedRect(15, y - 5, 180, 11, 2, 2, "F");
    addText(title.toUpperCase(), 11, true, [0, 110, 150]);
    y += 2;
  }

  // Professional header
  doc.setFillColor(8, 17, 30);
  doc.rect(0, 0, 210, 48, "F");

  doc.setTextColor(0, 200, 220);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(23);
  doc.text("PAGE PULSE", 17, 21);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text("Website Security Assessment Report", 17, 32);

  doc.setTextColor(160, 180, 195);
  doc.setFontSize(9);
  doc.text("DEFENSIVE SECURITY INTELLIGENCE", 17, 41);
  doc.setFontSize(8);
doc.setTextColor(180, 195, 210);
doc.text(`Report ID: ${reportId}`, 17, 55);
doc.text(`Generated: ${generatedAt}`, 17, 61);

  y = 72;

  // Website details
  addSection("Website information");
  addText(`Website: ${scanReport.url}`, 10, true);
  addText(
    `Scan date: ${new Date(scanReport.auditedAt).toLocaleString()}`
  );

  // Risk assessment
  addSection("Risk assessment");

  doc.setFillColor(245, 248, 252);
  doc.roundedRect(15, y, 180, 31, 3, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...riskColor);
  doc.text(String(riskScore), 23, y + 13);

  doc.setFontSize(9);
  doc.setTextColor(100, 110, 125);
  doc.text("/ 100 RISK SCORE", 23, y + 21);

  doc.setFontSize(12);
  doc.setTextColor(...riskColor);
  doc.text(`${riskLevel.toUpperCase()} RISK`, 115, y + 17);

  y += 40;

  addText(
    `Total security findings: ${summary?.total ?? 0}`,
    10,
    true
  );
    // Visual risk gauge
  addSection("Security score");

  const scoreValue =
    typeof riskScore === "number"
      ? Math.max(0, Math.min(100, riskScore))
      : 0;

  // Background bar
  doc.setFillColor(230, 235, 242);
  doc.roundedRect(15, y, 180, 12, 3, 3, "F");

  // Risk score progress
  if (scoreValue > 0) {
    doc.setFillColor(...riskColor);
    doc.roundedRect(
      15,
      y,
      1.8 * scoreValue,
      12,
      3,
      3,
      "F"
    );
  }

  y += 20;

  addText(
    `Security score: ${riskScore} / 100`,
    13,
    true,
    riskColor
  );

  addText(
    `Risk classification: ${riskLevel}`,
    10,
    true,
    riskColor
  );
    // Executive summary
  addSection("Executive summary");

  const totalFindings = summary?.total ?? 0;
  const highPriority =
    (summary?.critical ?? 0) + (summary?.high ?? 0);

  let executiveSummary = "";

  if (riskLevel === "Critical") {
    executiveSummary =
      `This website received a critical risk rating with a score of ${riskScore}/100. ` +
      `The assessment identified ${totalFindings} security findings, including ${highPriority} critical or high-priority issues. Immediate remediation is recommended.`;
  } else if (riskLevel === "High") {
    executiveSummary =
      `This website received a high risk rating with a score of ${riskScore}/100. ` +
      `${totalFindings} security findings were identified. Prioritize remediation of high-severity issues.`;
  } else {
    executiveSummary =
      `This website received a ${riskLevel.toLowerCase()} risk rating with a score of ${riskScore}/100. ` +
      `The assessment identified ${totalFindings} security findings. Review the recommendations below to improve its security posture.`;
  }

  addText(executiveSummary, 10, false);

  // Severity summary
  addSection("Severity summary");

  const severityItems = [
    { label: "Critical", value: summary?.critical ?? 0, color: [220, 38, 38] as [number, number, number] },
    { label: "High", value: summary?.high ?? 0, color: [234, 88, 12] as [number, number, number] },
    { label: "Medium", value: summary?.medium ?? 0, color: [202, 138, 4] as [number, number, number] },
    { label: "Low", value: summary?.low ?? 0, color: [22, 163, 74] as [number, number, number] },
  ];

  severityItems.forEach((item, index) => {
    const x = 15 + index * 45;

    doc.setFillColor(245, 248, 252);
    doc.roundedRect(x, y, 40, 23, 2, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...item.color);
    doc.text(String(item.value), x + 5, y + 10);

    doc.setFontSize(8);
    doc.setTextColor(80, 90, 105);
    doc.text(item.label, x + 5, y + 18);
  });

  y += 32;

  // Findings and remediation
  addSection("Security findings and remediation");

  scanReport.findings?.findings.forEach((finding, index) => {
    if (y > 245) {
      doc.addPage();
      y = 20;
    }

    addText(`${index + 1}. ${finding.title}`, 11, true);

    addText(
      `Severity: ${finding.severity} | Category: ${finding.category}`,
      9,
      true
    );

    addText(`Description: ${finding.description}`);
    addText(`Impact: ${finding.impact}`);
    addText(`Recommended remediation: ${finding.remediation}`);

    y += 5;
  });

  // Footer on every page
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);

    doc.setDrawColor(210, 220, 230);
    doc.line(15, 285, 195, 285);

    doc.setFontSize(8);
    doc.setTextColor(120, 130, 145);
    doc.text("PAGE PULSE | Website Security Assessment", 15, 291);
    doc.text(`Page ${page} of ${pageCount}`, 195, 291, {
      align: "right",
    });
  }

  doc.save("page-pulse-security-report.pdf");
}



function compareScans() {
  if (scanHistory.length < 2) {
    setMessage("You need at least two scans to compare.");
    return;
  }

  const latestScan = scanHistory[0];

  const olderScan = [...scanHistory]
    .slice(1)
    .find(
      (scan) =>
        scan.url.replace(/\/$/, "") ===
        latestScan.url.replace(/\/$/, "")
    );

  if (!olderScan) {
    setMessage("Scan the same website at least twice to compare results.");
    return;
  }

  setPreviousScan(olderScan);
  setCurrentScan(latestScan);
  setCompareMode(true);
  setMessage("Security comparison ready.");
}

function deleteScan(scanToDelete: ScanReport) {
  const updatedHistory = scanHistory.filter(
    (scan) =>
      !(
        scan.url === scanToDelete.url &&
        scan.auditedAt === scanToDelete.auditedAt
      )
  );

  setScanHistory(updatedHistory);

  localStorage.setItem(
    "page-pulse-history",
    JSON.stringify(updatedHistory)
  );

  setMessage("Scan record deleted successfully.");
}

function clearAllHistory() {
  setScanHistory([]);
  localStorage.removeItem("page-pulse-history");
  setMessage("All scan history cleared successfully.");
}

  return (
    <main className="min-h-screen bg-[#080d18] text-white">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-white/[0.07] bg-[#0b1220] p-6 lg:flex lg:flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 text-xl font-black text-[#08111e]">
              P
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-[0.12em]">
                PAGE PULSE
              </h1>
              <p className="text-[10px] tracking-wider text-slate-500">
                SECURITY INTELLIGENCE
              </p>
            </div>
          </div>

          <div className="mt-12">
            <p className="mb-4 text-[10px] font-semibold tracking-[0.2em] text-slate-500">
              WORKSPACE
            </p>
            <div className="space-y-2">
              {navigation.map((item) => (
                <button
                  key={item.name}
                  onClick={() => setActive(item.name)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${
                    active === item.name
                      ? "border border-cyan-400/20 bg-cyan-400/10 text-cyan-300"
                      : "text-slate-400 hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  <span className="text-lg">{item.icon}</span>
                  {item.name}
                  {item.name === "New Scan" && (
                    <span className="ml-auto text-xs text-cyan-400">↗</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto rounded-2xl border border-white/[0.08] bg-[#111c2e] p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-medium text-emerald-300">
                Engine interface ready
              </span>
            </div>
            <p className="text-xs leading-5 text-slate-400">
              Connect your security engine to begin analyzing websites.
            </p>
          </div>

          <div className="mt-5 border-t border-white/[0.07] pt-5">
            <p className="text-xs text-slate-500">Page Pulse v1.0</p>
            <p className="mt-1 text-[10px] text-slate-600">
              Defensive security platform
            </p>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="flex h-[76px] items-center justify-between border-b border-white/[0.07] px-6 lg:px-10">
            <div>
              <p className="text-xs text-slate-500">Workspace / {active}</p>
              <h2 className="mt-1 text-sm font-semibold text-slate-200">
                {active === "Overview" ? "Security overview" : active}
              </h2>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 sm:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-slate-400">System online</span>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 text-sm font-bold text-cyan-300">
                PP
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-7xl px-6 py-9 lg:px-10">
            <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-cyan-400">
                  WEBSITE SECURITY INTELLIGENCE
                </p>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  Protect what matters.
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                  Assess website security, uncover configuration weaknesses,
                  and get actionable remediation guidance.
                </p>
              </div>

              <button
                onClick={() => {
                  setActive("New Scan");
                  document.getElementById("scanner")?.scrollIntoView({
                    behavior: "smooth",
                  });
                }}
                className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-bold text-[#07111d] transition hover:bg-cyan-300"
              >
                + Start new scan
              </button>
            </div>


<div className="grid gap-4 sm:grid-cols-3">
  {[
    {
      label: "Websites scanned",
      value: new Set(scanHistory.map((scan) => scan.url)).size,
      note: `${scanHistory.length} total scan records`,
    },
    {
      label: "Security findings",
      value: scanHistory.reduce(
        (total, scan) => total + (scan.findings?.summary.total ?? 0),
        0
      ),
      note: "Across saved scans",
    },
    {
      label: "Critical issues",
      value: scanHistory.reduce(
        (total, scan) => total + (scan.findings?.summary.critical ?? 0),
        0
      ),
      note: "Across saved scans",
    },
  ].map((stat) => (
    <div
      key={stat.label}
      className="rounded-2xl border border-white/[0.08] bg-[#101a2a] p-5"
    >
      <p className="text-xs text-slate-400">{stat.label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">
        {stat.value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{stat.note}</p>
    </div>
  ))}
</div>


<div className="mt-8 grid gap-5 lg:grid-cols-2">
  <div className="rounded-2xl border border-white/[0.08] bg-[#101a2a] p-6">
    <h3 className="text-lg font-semibold">Severity distribution</h3>
    <p className="mt-1 text-xs text-slate-500">
      Findings across saved scan records
    </p>

    <div className="mt-6 space-y-5">
      {[
        { label: "Critical", value: severityStats.critical, color: "bg-red-500" },
        { label: "High", value: severityStats.high, color: "bg-orange-500" },
        { label: "Medium", value: severityStats.medium, color: "bg-yellow-400" },
        { label: "Low", value: severityStats.low, color: "bg-emerald-400" },
      ].map((item) => (
        <div key={item.label}>
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-slate-300">{item.label}</span>
            <span className="text-slate-400">{item.value}</span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-white/5">
            <div
              className={`h-full rounded-full ${item.color}`}
              style={{
                width: `${
                  totalSeverityFindings > 0
                    ? (item.value / totalSeverityFindings) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>

    <p className="mt-6 text-xs text-slate-500">
      Total findings: {totalSeverityFindings}
    </p>
  </div>

  <div className="rounded-2xl border border-white/[0.08] bg-[#101a2a] p-6">
    <h3 className="text-lg font-semibold">Latest risk assessment</h3>
    <p className="mt-1 text-xs text-slate-500">
      Most recent saved website scan
    </p>

    {scanHistory.length > 0 ? (
      <div className="mt-8">
        <p className="text-5xl font-bold text-cyan-300">
          {scanHistory[0].riskAssessment?.score ?? "N/A"}
          <span className="text-lg text-slate-500"> / 100</span>
        </p>

        <p className="mt-3 text-sm text-slate-400">
          {scanHistory[0].url}
        </p>

        <p className="mt-4 inline-block rounded-full bg-cyan-400/10 px-4 py-2 text-sm text-cyan-300">
          {scanHistory[0].riskAssessment?.riskLevel ?? "Unknown"} risk
        </p>
      </div>
    ) : (
      <p className="mt-8 text-sm text-slate-500">
        Run a website scan to view risk analytics.
      </p>
    )}
  </div>
</div>

<div className="mt-5 rounded-2xl border border-white/[0.08] bg-[#101a2a] p-6">
  <h3 className="text-lg font-semibold">Security assessment breakdown</h3>
  <p className="mt-1 text-xs text-slate-500">
    Latest scan module results
  </p>

  {scanHistory.length > 0 ? (
    <div className="mt-6 grid gap-4 sm:grid-cols-3">
      <div className="rounded-xl bg-[#0b1422] p-5">
        <p className="text-sm text-slate-400">Security headers</p>
        <p className="mt-3 text-2xl font-bold text-cyan-300">
          {scanHistory[0].securityHeaders?.passed ?? "N/A"}
          <span className="text-sm text-slate-500">
            {" "}/ {scanHistory[0].securityHeaders?.total ?? "N/A"}
          </span>
        </p>
        <p className="mt-2 text-xs text-slate-500">Headers passed</p>
      </div>

      <div className="rounded-xl bg-[#0b1422] p-5">
        <p className="text-sm text-slate-400">Cookie analysis</p>
        <p className="mt-3 text-2xl font-bold text-cyan-300">
          {scanHistory[0].cookieAnalysis?.secureCookies ?? "N/A"}
        </p>
        <p className="mt-2 text-xs text-slate-500">Secure cookies</p>
      </div>

      <div className="rounded-xl bg-[#0b1422] p-5">
        <p className="text-sm text-slate-400">TLS assessment</p>
        <p className="mt-3 text-2xl font-bold text-cyan-300">
          {scanHistory[0].tls?.protocol ?? "N/A"}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {scanHistory[0].tls?.authorized === true
            ? "Certificate authorized"
            : scanHistory[0].tls?.authorized === false
            ? "Certificate not authorized"
            : "Authorization unavailable"}
        </p>
      </div>
    </div>
  ) : (
    <p className="mt-5 text-sm text-slate-500">
      Run a scan to view assessment details.
    </p>
  )}
</div>



            <div
              id="scanner"
              className="relative mt-7 overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-[#12263a] to-[#101827] p-6 sm:p-8"
            >
              <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-cyan-400/[0.08] blur-3xl" />

              <div className="relative">
                <div className="mb-5 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
                    ⌕
                  </span>
                  <span className="text-xs font-semibold tracking-[0.15em] text-cyan-300">
                    QUICK SECURITY SCAN
                  </span>
                </div>

                <h3 className="text-2xl font-bold">
                  Analyze a website
                </h3>
                <p className="mt-2 text-sm text-slate-400">
                  Enter a URL to prepare a security assessment.
                </p>

                <form
                  onSubmit={handleScan}
                  className="mt-6 flex flex-col gap-3 sm:flex-row"
                >
                  <input
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setMessage("");
                    }}
                    placeholder="https://example.com"
                    aria-label="Website URL"
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#080f1b]/80 px-5 py-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-cyan-400 px-7 py-4 text-sm font-bold text-[#07111d] transition hover:bg-cyan-300"
                  >
                    Analyze website →
                  </button>
                </form>

                {message && (
                  <p role="status" className="mt-4 text-sm text-cyan-200">
                    {message}
                  </p>
                )}

                <p className="mt-4 text-xs text-slate-500">
                  Only scan websites you own or have permission to assess.
                </p>
              </div>
            </div>



{scanReport && (
  <section id="scan-results" className="mt-10 space-y-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <p className="text-xs font-semibold tracking-[0.15em] text-cyan-400">
          SECURITY ASSESSMENT
        </p>
        <h2 className="mt-2 text-2xl font-bold">Scan results</h2>
        <p className="mt-1 text-sm text-slate-400 break-all">
          {scanReport.url}
        </p>
      </div>
      <span className="w-fit rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
        Scan completed
      </span>
    </div>

<div className="flex justify-end">
  <button
    onClick={downloadPdfReport}
    className="rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
  >
    ↓ Download PDF Report
  </button>
</div>


    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-2xl border border-white/10 bg-[#101a2a] p-6">
        <p className="text-sm text-slate-400">Risk score</p>
        <p className="mt-3 text-4xl font-bold text-cyan-300">
          {scanReport.riskAssessment?.score ?? "N/A"} / 100
        </p>
        <p className="mt-2 text-sm text-slate-400">
          {scanReport.riskAssessment?.riskLevel ?? "Unknown"} risk
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#101a2a] p-6">
        <p className="text-sm text-slate-400">Total findings</p>
        <p className="mt-3 text-4xl font-bold">
          {scanReport.findings?.summary.total ?? 0}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#101a2a] p-6">
        <p className="text-sm text-slate-400">Security headers passed</p>
        <p className="mt-3 text-4xl font-bold">
          {scanReport.securityHeaders?.passed ?? 0} / {scanReport.securityHeaders?.total ?? 0}
        </p>
      </div>
    </div>

    <div className="grid gap-4 sm:grid-cols-4">
      {[
        { label: "Critical", count: scanReport.findings?.summary.critical ?? 0, color: "text-red-400" },
        { label: "High", count: scanReport.findings?.summary.high ?? 0, color: "text-orange-400" },
        { label: "Medium", count: scanReport.findings?.summary.medium ?? 0, color: "text-yellow-400" },
        { label: "Low", count: scanReport.findings?.summary.low ?? 0, color: "text-emerald-400" },
      ].map((item) => (
        <div key={item.label} className="rounded-xl border border-white/10 bg-[#101a2a] p-4">
          <p className="text-xs text-slate-400">{item.label} severity</p>
          <p className={`mt-2 text-2xl font-bold ${item.color}`}>
            {item.count}
          </p>
        </div>
      ))}
    </div>

    <div className="rounded-2xl border border-white/10 bg-[#101a2a] p-6">
      <h3 className="mb-5 text-xl font-semibold">Security findings</h3>

      <div className="space-y-3">
        {scanReport.findings?.findings.map((finding) => (
          <details key={finding.id} className="rounded-xl border border-white/10 bg-[#0b1422] p-4">
            <summary className="cursor-pointer">
              <span className="font-semibold">{finding.title}</span>
              <span className="ml-3 text-sm text-cyan-300">{finding.severity}</span>
            </summary>
            <div className="mt-4 space-y-3 text-sm text-slate-400">
              <p><strong className="text-cyan-300">Description:</strong> {finding.description}</p>
              <p><strong className="text-orange-300">Impact:</strong> {finding.impact}</p>
              <p><strong className="text-emerald-300">Remediation:</strong> {finding.remediation}</p>
            </div>
          </details>
        ))}
      </div>
    </div>
  </section>
)}

            <div className="mb-5 mt-10 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.15em] text-slate-500">
                  SECURITY MODULES
                </p>
                <h3 className="mt-2 text-xl font-semibold">
                  What Page Pulse examines
                </h3>
              </div>
              <span className="hidden text-xs text-slate-500 sm:block">
                Three assessment categories
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.number}
                  className="group rounded-2xl border border-white/[0.08] bg-[#101a2a] p-6 transition hover:-translate-y-1 hover:border-cyan-400/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.08] text-xl text-cyan-300">
                      {feature.icon}
                    </span>
                    <span className="text-xs text-slate-600">
                      {feature.number}
                    </span>
                  </div>
                  <h4 className="mt-6 text-base font-semibold">
                    {feature.title}
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>


<div className="mt-10 mb-5">
  <h2 className="text-xl font-bold text-white">
    Scan History
  </h2>
  <p className="mt-1 text-sm text-slate-400">
    Search, filter and manage your previous scans.
  </p>
</div>

<div className="mb-6 grid gap-3 md:grid-cols-3">
  <input
    type="text"
    value={historySearch}
    onChange={(event) => setHistorySearch(event.target.value)}
    placeholder="Search website URL..."
    className="rounded-xl border border-white/10 bg-[#101a2a] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400"
  />

  <div className="relative">
  <select
    value={riskFilter}
    onChange={(event) => setRiskFilter(event.target.value)}
    className="w-full appearance-none rounded-xl border border-white/10 bg-[#101a2a] px-4 py-3 pr-10 text-sm text-white outline-none focus:border-cyan-400"
  >
    <option value="All">All risk levels</option>
    <option value="Critical">Critical</option>
    <option value="High">High</option>
    <option value="Medium">Medium</option>
    <option value="Low">Low</option>
  </select>

  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
    ⌄
  </span>
</div>

  <div className="relative">
  <select
    value={historySort}
    onChange={(event) => setHistorySort(event.target.value)}
    className="w-full appearance-none rounded-xl border border-white/10 bg-[#101a2a] px-4 py-3 pr-10 text-sm text-white outline-none focus:border-cyan-400"
  >
    <option value="Newest">Newest first</option>
    <option value="Oldest">Oldest first</option>
  </select>

  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
    ⌄
  </span>
</div>
</div>
{scanHistory.length > 0 &&  (
  <div className="mt-6 flex justify-end">
    <button
      type="button"
      onClick={() => {
        if (window.confirm("Are you sure you want to delete all scan history?")) {
          clearAllHistory();
        }
      }}
      className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
    >
      Clear All History
    </button>
  </div>
)}

{scanHistory.length >= 2 && (
  <div className="mt-8 flex justify-end">
    <button
      type="button"
      onClick={compareScans}
      className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-400/20"
    >
      Compare Website Scans
    </button>
  </div>
)}

<div className="mt-8 space-y-4">
  {scanHistory.length === 0 ? (
    <div className="rounded-2xl border border-dashed border-white/10 px-6 py-8 text-center">
      <p className="text-sm font-medium text-slate-300">
        Your scan history will appear here
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Run your first assessment to start building your security history.
      </p>
    </div>
) : filteredHistory.length === 0 ? (
  <div className="rounded-2xl border border-dashed border-white/10 px-6 py-8 text-center">
    <p className="text-sm font-medium text-slate-300">
      No matching scans found
    </p>
    <p className="mt-2 text-xs text-slate-500">
      Try changing your search or risk filter.
    </p>
  </div>
) : (
    filteredHistory.map((scan, index) => (
      <div
        key={`${scan.url}-${scan.auditedAt}-${index}`}
        className="flex flex-col justify-between gap-4 rounded-xl border border-white/10 bg-[#101a2a] p-5 sm:flex-row sm:items-center"
      >
        <div>
          <p className="font-semibold break-all">{scan.url}</p>
          <p className="mt-1 text-xs text-slate-500">
            {new Date(scan.auditedAt).toLocaleString()}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs text-slate-500">Risk score</p>
            <p className="font-bold text-cyan-300">
              {scan.riskAssessment?.score ?? "N/A"} / 100
            </p>
          </div>

          <span className="rounded-full bg-cyan-400/10 px-3 py-2 text-xs text-cyan-300">
            {scan.riskAssessment?.riskLevel ?? "Unknown"}
          </span>

          <button
            type="button"
            onClick={() => {
  setScanReport(scan);
  setTimeout(() => {
    document.getElementById("scan-results")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 100);
}}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
          >
            View report
          </button>

          <button
  type="button"
  onClick={() => deleteScan(scan)}
  className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300 transition hover:bg-red-500/20"
>
  Delete
</button>
        </div>
      </div>
    ))
  )}
</div>


{compareMode && previousScan && currentScan && (
  <section className="mt-10 space-y-6 rounded-2xl border border-cyan-400/20 bg-[#101a2a] p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-semibold tracking-widest text-cyan-400">
          SECURITY INTELLIGENCE
        </p>
        <h2 className="mt-2 text-2xl font-bold">
          Scan Comparison
        </h2>
        <p className="mt-1 text-sm text-slate-400 break-all">
          {currentScan.url}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setCompareMode(false)}
        className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
      >
        Close comparison
      </button>
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-[#0b1422] p-5">
        <p className="text-sm text-slate-400">Previous risk score</p>
        <p className="mt-3 text-4xl font-bold text-slate-300">
          {previousScan.riskAssessment?.score ?? "N/A"}
          <span className="text-lg text-slate-500"> / 100</span>
        </p>
        <p className="mt-2 text-sm text-slate-400">
          {new Date(previousScan.auditedAt).toLocaleString()}
        </p>
      </div>

      <div className="rounded-xl border border-cyan-400/20 bg-[#0b1422] p-5">
        <p className="text-sm text-slate-400">Current risk score</p>
        <p className="mt-3 text-4xl font-bold text-cyan-300">
          {currentScan.riskAssessment?.score ?? "N/A"}
          <span className="text-lg text-slate-500"> / 100</span>
        </p>
        <p className="mt-2 text-sm text-slate-400">
          {new Date(currentScan.auditedAt).toLocaleString()}
        </p>
      </div>
    </div>

    {previousScan.riskAssessment?.score != null &&
      currentScan.riskAssessment?.score != null && (
        <div className="rounded-xl border border-white/10 bg-[#0b1422] p-5">
          <p className="text-sm text-slate-400">Risk score change</p>
          <p className={`mt-2 text-2xl font-bold ${
            currentScan.riskAssessment.score > previousScan.riskAssessment.score
              ? "text-emerald-400"
              : currentScan.riskAssessment.score < previousScan.riskAssessment.score
              ? "text-red-400"
              : "text-slate-300"
          }`}>
            {currentScan.riskAssessment.score -
              previousScan.riskAssessment.score > 0
              ? "+"
              : ""}
            {currentScan.riskAssessment.score -
              previousScan.riskAssessment.score} points
          </p>
          <p className="mt-1 text-xs text-slate-500">
            A higher score means a better security assessment in Page Pulse.
          </p>
        </div>
      )}

    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-white/10 p-5">
        <h3 className="font-semibold text-emerald-400">
          Resolved findings
        </h3>
        {previousScan.findings?.findings
          .filter((oldFinding) =>
            !currentScan.findings?.findings.some(
              (newFinding) => newFinding.id === oldFinding.id
            )
          ).length ? (
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {previousScan.findings?.findings
              .filter((oldFinding) =>
                !currentScan.findings?.findings.some(
                  (newFinding) => newFinding.id === oldFinding.id
                )
              )
              .map((finding) => (
                <li key={finding.id}>✓ {finding.title}</li>
              ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            No resolved findings detected.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-white/10 p-5">
        <h3 className="font-semibold text-red-400">
          Newly detected findings
        </h3>
        {currentScan.findings?.findings
          .filter((newFinding) =>
            !previousScan.findings?.findings.some(
              (oldFinding) => oldFinding.id === newFinding.id
            )
          ).length ? (
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {currentScan.findings?.findings
              .filter((newFinding) =>
                !previousScan.findings?.findings.some(
                  (oldFinding) => oldFinding.id === newFinding.id
                )
              )
              .map((finding) => (
                <li key={finding.id}>+ {finding.title}</li>
              ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            No newly detected findings.
          </p>
        )}
      </div>
    </div>
  </section>
)}



            <footer className="mt-10 border-t border-white/[0.07] py-6 text-center text-xs text-slate-600">
              PAGE PULSE © 2026 · Defensive Website Security Assessment
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
