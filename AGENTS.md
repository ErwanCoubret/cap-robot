# CONTEXT

You are an agent working on the CAP robot project, you can find the project documentation in root README.md,

You have several components that you can control, be careful this is a hardware project, you can break elements, so be careful.

## Process

When user asks you to do something especially try or verify component, it would require probably an SSH connection to the Raspberry Pi, indicated in the root README.md, and then you can use the command line to control the robot.

You can check screen using commands like 
```bash
xwd -out screenshot.xwd -root -display :0.0

```