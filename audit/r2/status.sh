#!/usr/bin/env bash
# One-line-per-area view of audit round 2: state, files ticked, findings,
# last checkpoint. Run from anywhere.
cd "$(dirname "$0")"
printf '%-16s %-12s %8s %6s %9s  %s\n' area state ticked open findings checkpoint
for d in areas/*/; do
  a=$(basename "$d"); p="$d/PROGRESS.md"; f="$d/FINDINGS.md"
  st=$(grep -m1 '^State:' "$p" 2>/dev/null | sed 's/State: *//'); st=${st:-"(none)"}
  done=$(grep -c '^- \[x\]' "$p" 2>/dev/null); todo=$(grep -c '^- \[ \]' "$p" 2>/dev/null)
  nf=$(grep -c '^### [A-Z]*-[0-9]' "$f" 2>/dev/null)
  ck=$(grep -m1 '^Last checkpoint' "$p" 2>/dev/null | sed 's/Last checkpoint: *//')
  printf '%-16s %-12s %8s %6s %9s  %s\n' "$a" "$st" "${done:-0}" "${todo:-0}" "${nf:-0}" "${ck:--}"
done
echo
echo "fixed:    $(grep -h '^- Status: fixed' areas/*/FINDINGS.md 2>/dev/null | wc -l | tr -d ' ')"
echo "accepted: $(grep -h '^- Status: accepted' areas/*/FINDINGS.md 2>/dev/null | wc -l | tr -d ' ')"
echo "open:     $(grep -h '^- Status: open' areas/*/FINDINGS.md 2>/dev/null | wc -l | tr -d ' ')"
echo "declined: $(grep -h '^- Status: declined' areas/*/FINDINGS.md 2>/dev/null | wc -l | tr -d ' ')"
