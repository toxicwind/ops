#!/usr/bin/env python3
"""Long-running turn for the stop-signal proof.

Loops until killed. The wrapper must terminate this child when a stop
arrives and exit promptly — it must not keep running, and it must not
start new work after the stop.
"""

import time

while True:
    time.sleep(0.2)
