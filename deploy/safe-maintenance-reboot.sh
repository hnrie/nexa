#!/bin/bash
# Wait up to an hour for package updates. DRY_RUN=1 never reboots or sleeps.
set -eu
for ((waited=0; waited<3600; waited+=60)); do
    if systemctl is-active --quiet apt-daily.service apt-daily-upgrade.service dpkg-db-backup.service 2>/dev/null ||
       pgrep -f '[u]nattended-upgrade($| )|[a]pt-get|[a]ptitude|dpkg --status-fd|dpkg --configure|[n]eedrestart' >/dev/null 2>&1; then
        logger -t nexa-maintenance "Package updates running; delaying reboot (${waited}s elapsed)."
        if [ "${DRY_RUN:-0}" = 1 ]; then echo 'DRY_RUN: updates busy, would wait.'; exit 2; fi
        sleep 60
    else
        if [ "${DRY_RUN:-0}" = 1 ]; then echo 'DRY_RUN: would reboot now.'; exit 0; fi
        exec /usr/sbin/shutdown -r now 'Scheduled maintenance reboot'
    fi
done
logger -t nexa-maintenance 'Updates still running after one hour; skipping reboot.'
