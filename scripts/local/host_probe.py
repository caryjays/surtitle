"""Content-free host load sampler for the captions service: stdout is protocol only.

Every interval it prints one JSON line with what else is using the Mac while captions run:

  {"type": "host", "intervalMs": int, "gpu": {"ours", "obs", "browser", "windowServer", "other"}, "thermal", "lowPower", "power"}

gpu values are each group's GPU busy time over the interval as a share of the interval, read from the per-process
accumulated GPU time IOKit keeps for each Metal client; groups can overlap, so the sum can exceed 1. "ours" is every
process whose parent is the probe's parent, the service: the recognizer and translator workers. IOKit's own device
utilization figure is not used: it reads near zero while MLX keeps the GPU busy. thermal is NSProcessInfo's thermal
state: nominal, fair, serious or critical. power is ac or battery. Any value it cannot read is null. Process names and
IDs are read here to classify and never printed. Needs no privileges and loads no model."""
import ctypes
import ctypes.util
import json
import os
import re
import subprocess
import sys
import time

THERMAL = ['nominal', 'fair', 'serious', 'critical']
GROUPS = ['ours', 'obs', 'browser', 'windowServer', 'other']
CREATOR = re.compile(r'"IOUserClientCreator" = "pid (\d+), ([^"]*)"')
GPU_TIME = re.compile(r'"accumulatedGPUTime"=(\d+)')


def classify(pid, name, ours):
    if pid in ours:
        return 'ours'
    lowered = name.lower()
    if lowered.startswith('obs'):
        return 'obs'
    if lowered.startswith(('google chrome', 'chrome', 'safari', 'com.apple.webkit', 'firefox', 'arc', 'microsoft edge')):
        return 'browser'
    if name == 'WindowServer':
        return 'windowServer'
    return 'other'


def parse_registry(text):
    """Accumulated GPU time in ns per pid and name, from `ioreg -l` output.

    Each client is one `+-o` node, and ioreg prints a node's properties in alphabetical order, so its AppUsage comes
    before its IOUserClientCreator: both are collected per node, never matched by order across nodes."""
    clients = {}
    creator, gpu_time = None, 0

    def flush():
        if creator:
            clients[creator] = clients.get(creator, 0) + gpu_time

    for line in text.splitlines():
        if '+-o ' in line:
            flush()
            creator, gpu_time = None, 0
            continue
        found = CREATOR.search(line)
        if found:
            creator = (int(found.group(1)), found.group(2))
        elif '"AppUsage"' in line:
            gpu_time += sum(int(value) for value in GPU_TIME.findall(line))
    flush()
    return clients


def shares(previous, current, ours, interval_ns):
    """GPU busy share of the interval per group. A client that is new, or whose total fell (pid reused), counts from zero."""
    if interval_ns <= 0:
        return None
    groups = dict.fromkeys(GROUPS, 0)
    for key, total in current.items():
        before = previous.get(key, 0)
        groups[classify(key[0], key[1], ours)] += total - before if total >= before else total
    return {group: round(min(8.0, value / interval_ns), 3) for group, value in groups.items()}


def run(command):
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=2).stdout
    except (OSError, subprocess.SubprocessError):
        return None


def children(parent):
    pids = set()
    for line in (run(['ps', '-A', '-o', 'pid=,ppid=']) or '').splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[1] == str(parent):
            pids.add(int(fields[0]))
    return pids


def power_source():
    text = run(['pmset', '-g', 'ps'])
    if text is None:
        return None
    return 'ac' if "'AC Power'" in text else 'battery' if "'Battery Power'" in text else None


class ProcessInfo:
    """NSProcessInfo's thermalState and isLowPowerModeEnabled through the Objective-C runtime, without PyObjC."""

    def __init__(self):
        try:
            self.objc = ctypes.cdll.LoadLibrary(ctypes.util.find_library('objc'))
            ctypes.cdll.LoadLibrary('/System/Library/Frameworks/Foundation.framework/Foundation')
            self.objc.objc_getClass.restype = ctypes.c_void_p
            self.objc.sel_registerName.restype = ctypes.c_void_p
            self.send = self.objc.objc_msgSend
            self.send.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
            self.send.restype = ctypes.c_void_p
            self.info = self.send(self.objc.objc_getClass(b'NSProcessInfo'), self.objc.sel_registerName(b'processInfo'))
        except (OSError, AttributeError, TypeError):
            self.info = None

    def value(self, selector):
        if not self.info:
            return None
        self.send.restype = ctypes.c_long
        try:
            return self.send(self.info, self.objc.sel_registerName(selector))
        finally:
            self.send.restype = ctypes.c_void_p

    def thermal(self):
        state = self.value(b'thermalState')
        return THERMAL[state] if state is not None and 0 <= state < len(THERMAL) else None

    def low_power(self):
        state = self.value(b'isLowPowerModeEnabled')
        return None if state is None else bool(state & 0xFF)


def main():
    # The process that started the probe is the service; its other children are the recognizer and translator.
    parent = os.getppid()
    interval = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0
    info = ProcessInfo()
    previous, previous_at = None, None
    while True:
        text = run(['ioreg', '-l', '-w0', '-r', '-c', 'IOAccelerator'])
        at = time.monotonic_ns()
        clients = parse_registry(text) if text is not None else None
        if previous_at is not None:
            gpu = shares(previous, clients, children(parent), at - previous_at) if clients is not None and previous is not None else None
            sys.stdout.write(json.dumps({'type': 'host', 'intervalMs': round((at - previous_at) / 1e6), 'gpu': gpu,
                                         'thermal': info.thermal(), 'lowPower': info.low_power(), 'power': power_source()}) + '\n')
            sys.stdout.flush()
        previous, previous_at = clients, at
        time.sleep(interval)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, BrokenPipeError):
        pass
