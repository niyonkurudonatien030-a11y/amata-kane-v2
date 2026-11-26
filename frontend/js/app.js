const $ = (selector) => document.querySelector(selector);

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Request failed");
  return data;
}
function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.className = "message " + (isError ? "error" : "ok");
}
function money(value) {
  return new Intl.NumberFormat("en-RW", {maximumFractionDigits: 0}).format(value) + " RWF";
}
async function loadDeals() {
  const target = $("#deals");
  try {
    const deals = await api("/api/deals");
    if (!deals.length) {
      target.innerHTML = '<p class="muted">No deals yet. Create the first deal above.</p>';
      return;
    }
    target.replaceChildren();
    deals.forEach(deal => {
      const card = document.createElement("article");
      card.className = "deal";
      const title = document.createElement("h3");
      title.textContent = `${deal.farmer_name} → ${deal.buyer_name}`;
      const details = document.createElement("p");
      details.textContent = `${deal.milk_litres} L · ${money(deal.price_per_litre)} / L · Total ${money(deal.milk_litres * deal.price_per_litre)}`;
      const meta = document.createElement("p");
      meta.textContent = `Deal ID: ${deal.id} · Pickup: ${deal.pickup_date} · ${deal.location || "Location not specified"}`;
      const status = document.createElement("span");
      status.className = "pill";
      status.textContent = `${deal.status} · Payment: ${deal.payment_status}`;
      const actions = document.createElement("p");
      actions.className = "actions";
      ["farmer", "buyer"].forEach(role => {
        const button = document.createElement("button");
        button.type = "button"; button.className = "secondary";
        button.style.margin = "5px 6px 0 0";
        button.textContent = `Accept as ${role}`;
        button.addEventListener("click", async () => {
          try {
            await api(`/api/deals/${deal.id}/accept`, {
              method: "POST", headers: {"Content-Type":"application/json"},
              body: JSON.stringify({role})
            });
            await loadDeals();
          } catch (e) { alert(e.message); }
        });
        actions.append(button);
      });
      const payment = document.createElement("select");
      payment.setAttribute("aria-label", "Payment status");
      ["UNCONFIRMED","REPORTED_PAID","CONFIRMED_BY_BOTH","DISPUTED"].forEach(value => {
        const option = document.createElement("option");
        option.value = value; option.textContent = value.replaceAll("_"," ");
        option.selected = value === deal.payment_status;
        payment.append(option);
      });
      payment.addEventListener("change", async () => {
        try {
          await api(`/api/deals/${deal.id}/payment`, {
            method:"POST", headers:{"Content-Type":"application/json"},
            body:JSON.stringify({status:payment.value})
          });
          await loadDeals();
        } catch(e) { alert(e.message); }
      });
      const paymentLabel = document.createElement("label");
      paymentLabel.textContent = "Payment status (self-reported):";
      paymentLabel.append(payment);
      card.append(title, details, meta, status, actions, paymentLabel);
      target.append(card);
    });
  } catch (e) {
    target.textContent = "Could not load deals: " + e.message;
  }
}
$("#deal-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#deal-message");
  const values = Object.fromEntries(new FormData(form).entries());
  values.milk_litres = Number(values.milk_litres);
  values.price_per_litre = Number(values.price_per_litre);
  try {
    const result = await api("/api/deals", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(values)
    });
    showMessage(message, `Deal saved. Your Deal ID is ${result.deal.id}. Share this ID with the other party.`);
    form.reset();
    await loadDeals();
  } catch(e) { showMessage(message, e.message, true); }
});
$("#evidence-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#evidence-message");
  const data = new FormData(form);
  const dealId = data.get("deal_id").trim();
  try {
    const result = await api(`/api/deals/${encodeURIComponent(dealId)}/evidence`, {
      method:"POST", body:data
    });
    showMessage(message, `Evidence saved (${result.evidence_id}).\n\nGemini's preliminary description:\n${result.ai_summary}\n\n${result.warning}`);
    form.reset();
    await loadDeals();
  } catch(e) { showMessage(message, e.message, true); }
});
$("#refresh").addEventListener("click", loadDeals);
loadDeals();
