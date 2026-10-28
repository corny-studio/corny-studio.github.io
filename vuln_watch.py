#!/usr/bin/env python3
"""
vuln_watch_daemon.py — passive port, banner, and HTTP-security-header monitor.

SCOPE / AUTHORIZATION — unchanged from the original vuln_watch.py
  This only ever touches hosts listed in config.json's "targets". It still never sends
  exploit payloads and never confirms a vulnerability is exploitable — banner checks and
  the HTTP security-header audit below are both purely passive: a connection, and reading
  whatever the service already volunteers. Only point this at hosts you own or have
  explicit written authorization to test.

WHAT'S NEW VS. THE SIMPLER vuln_watch.py
  - A class-based structure with rotating log files, for longer-term unattended use.
  - A second passive check: whether a web target sends standard defensive headers
    (HSTS, X-Frame-Options, X-Content-Type-Options, CSP) — same idea as the live check
    already built into your portfolio site, applied here to whatever you're monitoring.
  - Findings (flagged banners + missing headers) are compared run-over-run, the same way
    ports already were, so a finding that's STILL present doesn't re-alert every run —
    only a NEW finding does. A finding that gets fixed is reported too, as good news.
  - HTTPS targets (443, 8443) are audited over a real TLS connection, not plain HTTP.

WHAT THIS STILL DOES NOT DO
  No exploit confirmation, no payloads beyond a HEAD request, no scanning outside the
  configured target list.
"""

import argparse
import json
import logging
import os
import re
import smtplib
import socket
import ssl
import sys
import time
import http.client
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from logging.handlers import RotatingFileHandler

OUTDATED_PATTERNS = [
    (re.compile(r"ssh[-_]1\."), "SSH Protocol v1.x (obsolete, vulnerable to interception)"),
    (re.compile(r"openssh[-_][1-6]\."), "Legacy OpenSSH v1.x-6.x (multiple known remote flaws)"),
    (re.compile(r"apache[-_/][12]\.[0-3]\."), "Outdated Apache HTTPD v1.x-2.3"),
    (re.compile(r"iis/[1-7]\.0"), "Legacy Microsoft IIS v1.0-7.0 (end-of-life)"),
]

# Ports audited for HTTP security headers; HTTPS ports use a real TLS connection.
WEB_PORTS = {80, 8080}
WEB_PORTS_TLS = {443, 8443}

CRITICAL_HEADERS = {
    "strict-transport-security": "Missing HSTS (no Strict-Transport-Security header)",
    "x-frame-options": "Missing clickjacking protection (no X-Frame-Options or frame-ancestors)",
    "x-content-type-options": "Missing MIME-sniffing protection (no X-Content-Type-Options: nosniff)",
    "content-security-policy": "Missing Content-Security-Policy",
}


class SmartClientSecurityDaemon:
    def __init__(self, config_path="config.json", history_path="state.json", log_path="vuln_watch.log"):
        self.config_path = config_path
        self.history_path = history_path

        self.logger = logging.getLogger("vuln_watch_daemon")
        self.logger.setLevel(logging.INFO)
        if not self.logger.handlers:
            handler = RotatingFileHandler(log_path, maxBytes=5_000_000, backupCount=5)
            handler.setFormatter(logging.Formatter("%(asctime)s - [%(levelname)s] - %(message)s"))
            self.logger.addHandler(handler)

        self.config = self.load_config()
        self.history = self.load_history()

    # ---------- config / state I/O ----------

    def load_config(self):
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self.logger.critical(f"Could not read config: {e}")
            sys.exit(1)

    def load_history(self):
        if os.path.exists(self.history_path):
            try:
                with open(self.history_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                self.logger.error(f"Could not read history (starting fresh): {e}")
        return {}

    def save_history(self):
        try:
            with open(self.history_path, "w", encoding="utf-8") as f:
                json.dump(self.history, f, indent=2)
        except Exception as e:
            self.logger.error(f"Could not save history: {e}")

    # ---------- passive checks ----------

    def banner_grab(self, host, port):
        """A single HEAD request (or a raw connect for non-HTTP ports). Never sends
        anything else. Returns None on any failure, including a closed port."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(3.0)
                if s.connect_ex((host, port)) != 0:
                    return None
                if port in WEB_PORTS:
                    s.sendall(f"HEAD / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())
                banner = s.recv(1024).decode("utf-8", errors="ignore").strip()
                return banner if banner else "(open, no banner volunteered)"
        except Exception as e:
            self.logger.debug(f"banner_grab {host}:{port} failed: {e}")
            return None

    def check_outdated(self, banner):
        if not banner:
            return []
        hits = []
        low = banner.lower()
        for pattern, note in OUTDATED_PATTERNS:
            if pattern.search(low):
                hits.append(note)
        return hits

    def audit_security_headers(self, host, port):
        """Checks for standard defensive headers on a web port. Plain HTTP for WEB_PORTS,
        a real TLS handshake for WEB_PORTS_TLS — the earlier version used plain HTTP even
        on 443, which fails silently and was swallowed by a bare except."""
        try:
            if port in WEB_PORTS_TLS:
                ctx = ssl.create_default_context()
                conn = http.client.HTTPSConnection(host, port, timeout=4, context=ctx)
            elif port in WEB_PORTS:
                conn = http.client.HTTPConnection(host, port, timeout=4)
            else:
                return []
            conn.request("HEAD", "/")
            resp = conn.getresponse()
            headers = {k.lower(): v for k, v in resp.getheaders()}
            conn.close()
            return [msg for key, msg in CRITICAL_HEADERS.items() if key not in headers]
        except Exception as e:
            self.logger.debug(f"audit_security_headers {host}:{port} failed: {e}")
            return []

    # ---------- one scan of one host ----------

    def scan_host(self, host, ports):
        open_ports, findings = [], []
        for port in ports:
            banner = self.banner_grab(host, port)
            if banner is None:
                continue
            open_ports.append(port)
            for note in self.check_outdated(banner):
                findings.append(f"port {port}: {note}")
            for note in self.audit_security_headers(host, port):
                findings.append(f"port {port}: {note}")
        return {"open_ports": sorted(open_ports), "findings": sorted(set(findings))}

    # ---------- run-over-run comparison (the piece that was missing) ----------

    @staticmethod
    def diff_sets(previous, current):
        """Returns (new_items, resolved_items). Pure and separately testable."""
        prev, curr = set(previous), set(current)
        return sorted(curr - prev), sorted(prev - curr)

    def compare_to_last_run(self, host, current_state):
        last_runs = self.history.get(host, [])
        if not last_runs:
            return {"new_ports": [], "closed_ports": [], "new_findings": current_state["findings"], "resolved_findings": []}
        last = last_runs[-1]
        new_ports, closed_ports = self.diff_sets(last.get("open_ports", []), current_state["open_ports"])
        new_findings, resolved_findings = self.diff_sets(last.get("findings", []), current_state["findings"])
        return {"new_ports": new_ports, "closed_ports": closed_ports, "new_findings": new_findings, "resolved_findings": resolved_findings}

    # ---------- the full assessment ----------

    def execute_security_assessment(self, baseline=False):
        self.config = self.load_config()
        results = []
        anything_new = False

        for target in self.config.get("targets", []):
            host, ports = target["host"], target.get("ports", [])
            label = target.get("label", host)

            current_state = self.scan_host(host, ports)
            delta = {} if baseline else self.compare_to_last_run(host, current_state)

            self.history.setdefault(host, []).append(current_state)
            self.history[host] = self.history[host][-50:]

            is_new = bool(delta.get("new_ports") or delta.get("new_findings"))
            has_resolved = bool(delta.get("closed_ports") or delta.get("resolved_findings"))
            if baseline or is_new or has_resolved:
                anything_new = anything_new or is_new
                results.append({"label": label, "host": host, "current": current_state, "delta": delta, "is_new": is_new})

        self.save_history()

        if baseline:
            self.dispatch_email(results, kind="baseline")
        elif results:
            self.dispatch_email(results, kind="threat" if anything_new else "improved")
        else:
            self.logger.info("No change since last run.")

    # ---------- reporting / email ----------

    @staticmethod
    def format_report(results, kind):
        lines = []
        for r in results:
            lines.append(f"\n{r['label']} ({r['host']})")
            d = r.get("delta", {})
            for p in d.get("new_ports", []):
                lines.append(f"  + port {p} is now OPEN")
            for p in d.get("closed_ports", []):
                lines.append(f"  - port {p} is now closed")
            for f in d.get("new_findings", []):
                lines.append(f"  ! NEW: {f}")
            for f in d.get("resolved_findings", []):
                lines.append(f"  ✓ resolved: {f}")
            if kind == "baseline":
                lines.append(f"  open ports: {r['current']['open_ports'] or 'none'}")
                for f in r["current"]["findings"]:
                    lines.append(f"  finding: {f}")
        return "\n".join(lines) if lines else "No findings."

    def dispatch_email(self, results, kind):
        smtp_cfg = self.config.get("smtp", {})
        user = os.getenv(smtp_cfg.get("user_env", ""))
        password = os.getenv(smtp_cfg.get("pass_env", ""))
        body = self.format_report(results, kind)
        subject = {
            "threat": "vuln_watch: new finding(s) detected",
            "improved": "vuln_watch: issue(s) resolved",
            "baseline": "vuln_watch: baseline established",
        }[kind]

        if not user or not password:
            self.logger.error("SMTP credentials not set; printing instead of emailing.")
            print(subject, "\n", body)
            return
        try:
            msg = MIMEMultipart()
            msg["From"] = smtp_cfg.get("from_addr")
            msg["To"] = smtp_cfg.get("to_addr")
            msg["Subject"] = subject
            msg.attach(MIMEText(body, "plain"))
            with smtplib.SMTP(smtp_cfg.get("host"), smtp_cfg.get("port")) as server:
                server.starttls(context=ssl.create_default_context())
                server.login(user, password)
                server.sendmail(msg["From"], msg["To"], msg.as_string())
            self.logger.info(f"Alert sent ({kind}).")
        except Exception as e:
            self.logger.error(f"SMTP send failed: {e}")

    # ---------- optional: run as its own scheduler instead of cron ----------

    def run_forever(self):
        """An internal scheduling loop, as an ALTERNATIVE to cron, not in addition to it.
        If you've already set up cron (as in the simpler vuln_watch.py), use that — don't
        run both, or you'll scan on two independent schedules at once."""
        interval = self.config.get("daemon_interval_seconds", 10800)  # 3 hours, matching the cron cadence
        self.logger.info(f"Starting continuous loop, interval={interval}s. Ctrl+C to stop.")
        try:
            while True:
                self.execute_security_assessment()
                time.sleep(interval)
        except KeyboardInterrupt:
            self.logger.info("Stopped by user.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--daemon", action="store_true", help="run forever instead of once (don't combine with cron)")
    args = parser.parse_args()
    d = SmartClientSecurityDaemon()
    if args.daemon:
        d.run_forever()
    else:
        d.execute_security_assessment(baseline=args.baseline)


if __name__ == "__main__":
    main()
