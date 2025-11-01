#!/bin/bash
# Reset terminal to default state
printf '\033[?1000l'  # Disable X11 mouse
printf '\033[?1002l'  # Disable cell motion tracking
printf '\033[?1003l'  # Disable all motion tracking
printf '\033[?1006l'  # Disable SGR mouse mode
printf '\033[?1015l'  # Disable urxvt mouse mode
printf '\033[?1016l'  # Disable SGR pixel mode
printf '\033[?25h'    # Show cursor
printf '\033[0m'      # Reset attributes
printf '\033c'        # Full reset
stty sane 2>/dev/null || true
echo "Terminal reset complete"
