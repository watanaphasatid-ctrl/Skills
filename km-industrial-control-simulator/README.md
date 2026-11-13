# K.M. Industrial Control Simulator

Interactive web simulator of a tank-level control loop (pump, valves, sensors, PID, alarms,
interlocks, emergency stop) by K.M. Hybrid Mechatronics.

> **Simulation only.** There is no hardware I/O in this project. The control core talks to a
> `FieldIO` interface and the only implementation is `SimulatedFieldIO` (software plant model).
> It is a training tool, not a certified safety system, and must not be used for safety decisions.

## Features
- Dashboard with interactive 3D plant (three.js): orbit/zoom, click equipment for details, drag the red
  setpoint tab on the tank, press the physical E-stop post.
- Control page: Manual/Auto (bumpless), setpoint, Kp/Ki/Kd, P/I/D term bars, tuning presets, valve commands.
- Trends: PV / setpoint / output with alarm limits, pressure and flow charts, 1 min to 1 h windows, freeze, CSV export.
- Alarms (ISA-18.2 style states, on-delay, deadband, acknowledge, history), latched interlocks, run permissive, E-stop with release + reset.
- Settings: simulation speed 1x-20x, alarm limits, noise, fault injection (sensor / pump), persisted in `localStorage`.
- Responsive (phone bottom-nav, desktop rail), keyboard-focus styles, reduced-motion support.

## Run
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests (vitest, Node)
npm run build      # typecheck + production build to dist/
npm run e2e        # browser test of dist/ (needs Playwright + Chromium installed separately)
```

## Safety logic
| Id | Trigger | Action | Latched |
|----|---------|--------|---------|
| IL-01 | LSHH level switch (95 %, independent of LT-101) | trip pump, close inlet valve | yes |
| IL-02 | LSLL level switch (5 %) | close outlet valve | yes |
| IL-03 | PT-101 >= 5.0 bar or invalid reading | trip pump (inlet stays open) | yes |
| P-01 | inlet valve < 20 % open | pump inhibited | no |
| ES-001 | operator | pump 0, inlet closed, Manual 0 %; release + reset required | yes |

Trips drop the controller to Manual 0 %; after a reset the pump stays off until the operator commands it.
Bad LT-101 quality in Auto falls back to Manual (hold) and refuses Auto. I/O read failure drives safe outputs.

## Layout
```
src/core   pure TypeScript control logic (pid, plant, io, alarms, safety, controlSystem, simulation)
src/app    runtime loop (fixed-step accumulator), settings persistence, trend helpers
src/ui     Preact views, canvas charts, three.js scene
tests      vitest suites; e2e  Playwright browser smoke test; docs  design notes
```

## Known limitations
- Plant parameters are plausible training values, not validated against any real process.
- No hardware-in-the-loop testing exists or is possible with this project as shipped.
- 3D rendering needs WebGL; without it the rest of the UI still works.
