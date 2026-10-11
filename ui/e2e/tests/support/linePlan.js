// A change to a Line project as Cockpit makes it, for specs that drive the API directly: every change is a plan step
// (the old direct write routes are gone). Add the step, approve it as the Cockpit page does (its Origin plus the
// approval token GET /api/line/plan hands out), run it. A step that did not land is left as it is, so the plan does
// not hold the next change. Answers {status, body} for a refusal before the step joined the plan, else {step, apply}.
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;

export async function planChange(request, api, tool, args) {
  const { approvalToken } = await (await request.get(`${api}/api/line/plan`)).json();
  const headers = { origin: CLIENT_ORIGIN, 'x-line-approval': approvalToken };
  const added = await request.post(`${api}/api/line/plan/step`, { data: { tool, args }, headers });
  const body = await added.json();
  if (added.status() !== 200) return { status: added.status(), body };
  await request.post(`${api}/api/line/plan/approve`, { data: { stepId: body.stepId }, headers });
  const ran = await (await request.post(`${api}/api/line/plan/run`, { data: { stepId: body.stepId }, headers })).json();
  const step = ran.steps.find((s) => s.id === body.stepId);
  if (step.state !== 'done') {
    const leave = await (await request.post(`${api}/api/line/plan/step`, { data: { tool: 'line.leaveAsIs', args: { stepId: step.id } }, headers })).json();
    await request.post(`${api}/api/line/plan/approve`, { data: { stepId: leave.stepId }, headers });
    await request.post(`${api}/api/line/plan/run`, { data: { stepId: leave.stepId }, headers });
  }
  return { status: 200, step, apply: step.result?.apply ?? null };
}
