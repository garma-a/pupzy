# Acting on content closes its reports, and restoring never reopens them

Status: accepted

When an administrator removes a Post, hides or removes a Comment or Reply, or bans a Pupzy Account, every open report on that target closes in the same transaction as "action taken", wherever the action was taken. Removing a Post also closes the open Comment Reports on its discussion, because a Removed Post exposes no discussion. Approving a Post closes its Post Reports as "no action"; flagging leaves them open. Restoring content never reopens or closes reports. We chose this over keeping reports and moderation actions independent because moderators otherwise faced a queue full of reports for content that had already been dealt with. The cost is that a restore after a mistaken removal leaves the earlier reports closed; new reports start a new case.
