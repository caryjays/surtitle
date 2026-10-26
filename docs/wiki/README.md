# Wiki

The current-state reference for Surtitle. Every page describes the code as it is; history is in [the log](../log/README.md).

## New session

Read in order, about ten minutes:

1. [Overview](overview.md): what it is, what it is not, how to launch.
2. [Status](status.md): what works, what is open, what to do next.
3. [Architecture](architecture.md): components, one turn end to end, every bound in one table.
4. [Practices](practices.md): how to keep these pages true before you edit anything.

Then the page for the area you touch. [AGENTS.md](../../AGENTS.md) holds the mandatory rules. The maintainer's personal context lives in the ignored `private/` directory and is never linked from here.

## Pages

| Page | Covers |
| --- | --- |
| [overview](overview.md) | Purpose, product contract, launch profiles, configuration, hardware, scope |
| [status](status.md) | Verified vs observed vs untested, ranked open problems, priorities, next session |
| [architecture](architecture.md) | Topology, components, turn lifecycle, identity tokens, bounds, failure policy |
| [recognition](recognition.md) | Models and pins, worker RPC, decode and filter pipeline, segmentation, baseline |
| [translation](translation.md) | Responses request and validation, direction policy, failure mapping, cost and retention |
| [surfaces](surfaces.md) | Operator page controls and capture settings, overlay rules, shared schema |
| [diagnostics](diagnostics.md) | Collecting the content-free log, event and trace fields, how to read it |
| [security-privacy](security-privacy.md) | Boundary rules, retention, credential rules |
| [operations](operations.md) | Commands, listening session procedure, OBS, failure ladder |
| [testing](testing.md) | Every check command, fixtures, where results go |
| [decisions](decisions.md) | Dated decisions with reasons |
| [roadmap](roadmap.md) | Milestones and standing |
| [practices](practices.md) | How the wiki and log stay true |
