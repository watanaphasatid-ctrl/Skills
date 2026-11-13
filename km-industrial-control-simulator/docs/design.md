# K.M. Industrial Control Simulator — Design (short form)

Status: written by the implementer after the requester opted out of the Q&A step
("deliver working software, not a plan"). Every choice below is the implementer's call.

## Intent
A web-based, interactive simulator of a tank-level control loop for training, demos and
PID tuning practice under the K.M. Hybrid Mechatronics name. Users change the setpoint, tune
Kp/Ki/Kd, switch Manual/Auto and watch the loop respond in real time, including alarms,
interlocks and emergency stop.

## Goals
- Correct, testable control logic (PID with anti-windup, bumpless transfer, filtered derivative).
- Safety logic modelled after common practice (ISA-18.2 style alarm states, latched trips,
  independent level switches, run permissive, E-stop that needs explicit release + reset).
- Interactive 3D plant (tank, pump, valves, sensors) and live trends.
- Responsive UI (desktop, tablet, phone). White / red / grey palette.

## Non-goals / Anti-goals
- NOT a SIL-rated safety system and NOT a substitute for real functional-safety design.
- No real hardware I/O. The control core talks only to the `FieldIO` interface; the only
  implementation shipped is `SimulatedFieldIO`. A real driver (Modbus/BACnet/OPC UA) is
  deliberately not included and would need its own safety review.
- No backend, no accounts, no persistence besides localStorage for settings.

## Approaches considered
1. **Framework-free TS + canvas + three.js** — smallest, but verbose UI state handling.
2. **Preact + TS + three.js + hand-written canvas charts (chosen)** — 3 kB runtime, components for
   five pages, pure-TS core that is UI-agnostic and unit-testable in Node.
3. React + chart library — heavier, extra dependency surface, no benefit for this scope.

## Architecture
```
src/core   pure TypeScript, no DOM          <- unit tested (vitest, node)
  pid.ts        PID controller
  plant.ts      tank/pump/valve physical model + fault injection
  io.ts         FieldIO interface + SimulatedFieldIO (sensor filter/noise on top of plant)
  alarms.ts     alarm manager (limits, deadband, on-delay, ack/RTN, history)
  safety.ts     interlocks, permissives, E-stop latch
  controlSystem.ts  orchestrates mode, PID, safety, IO, history
src/ui     Preact views, canvas trend chart, three.js scene
```
Control core runs at a fixed 100 ms scan; the UI loop uses a time accumulator (speed 1x-20x).

## Process model (simulation assumptions — NOT field-validated)
Tank D=0.8 m, H=1.5 m. Fill pump 8 L/s max (first-order lag 2 s), inlet valve and outlet valve
stroke 6 s end-to-end, outlet flow = 11.3 L/s · opening · sqrt(level/H). Discharge pressure rises
toward 6 bar when the pump runs against a closed inlet valve.

## Safety logic summary
| Id | Trigger | Action | Latched |
|----|---------|--------|---------|
| IL-01 | LSHH level switch (95 %) | trip pump, close inlet valve | yes |
| IL-02 | LSLL level switch (5 %) | close outlet valve | yes |
| IL-03 | PT-101 >= 5.0 bar | trip pump | yes |
| P-01  | inlet valve < 20 % open | pump run permissive false (no trip) | no |
| ESTOP | operator | pump 0, inlet closed, controller to Manual 0 %, needs release + reset | yes |
| DEG   | LT-101 bad quality | Auto -> Manual hold, Auto refused | while fault |

## Left to the builder
Tuning defaults, visual details, copy.
