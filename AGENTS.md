This is a typescript project with a set of libraries that should be able to run in a browser or on the backend using node.  

This is an early stage project and the API stability doesn't need to be maintained yet.  Pull requests are also not needed at this stage, we push commits directly to main.


# Planning Rules

When planning a new feature, add a plan markdown document in the `plans` folder.  

The document should follow these rules...
- Break the work down into managable tasks.  All tasks should have checkboxes to indicate when they are complete.  Tasks should be numbered so that it is easy to reference them in conversation.

- Update the plan as needed when the design evolves.  This is a living document that should reflect the current state of the design.

- Pay attention to the shape of the code.  Note important classes and functions and how they interact with each other.  Document new abstractions and changes to existing ones.

- Consequential design questions should be documented as sub-tasks.  Make sure it is easy to identify so that a reader can quickly find areas of concern.  
  - Whether or not something is `Consequential` is a combination of 2 factors.
    - `Uncertainty` - For uncertainty consider the goal.  If you don't know why something is being done then there is a good chance of making poor decisions.
    - `Impact` - consider the following question "If we get this wrong, will it cause a lot of rework?"  If the answer is yes, then it's a consequential design question that should be a decision sub-task in the plan.
  - Less consequential design questions should be noted briefly as assumptions, This gives a reviewer the ability to quickly understand the design without polluting the plan with obvious details.  For less consequential design questions, it is better to make an assumption and move forward rather than getting stuck on the question.  If it turns out to be a bad decision, it can be iterated on later.
  - Visual style is not consequential.  It is very important, but it is better to push forward and iterate on it rather than getting stuck on it.


# Plan Implementation Rules
- Proceed sequentially through the implementation tasks in the plan.  If you find yourself skipping around then the plan needs to be updated to better reflect the current state.

  - For each task address any design sub-tasks first.  Ask for clarification when needed.  Consequential design decisions should be made by humans.

  - Continue processing autonomously until you reach a design sub-task.  After completing a task, move to the next task.  Only stop when you reach a design sub-task, and ask for clarification before proceeding.  

  - When stopping always tell the user where you are in the plan.
 
  - Update the plan when tasks are complete, and note anything that changed during implementation. Update the plan with new assumptions or if new consequential issues arise, create a decision sub-task.

- New features and bug fixes should always include unit tests.
