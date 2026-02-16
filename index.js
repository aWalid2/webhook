const express = require("express");
const body_parser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
//hamoo

const fs = require("fs").promises;
const path = require("path");

const app = express().use(body_parser.json());

const productsFile = path.join(__dirname, "products.json");

async function ensureProductsFile() {
  try {
    await fs.access(productsFile);
  } catch (e) {
    await fs.writeFile(productsFile, "[]", "utf8");
  }
}

async function readProducts() {
  await ensureProductsFile();
  const raw = await fs.readFile(productsFile, "utf8");
  try {
    return JSON.parse(raw || "[]");
  } catch (e) {
    return [];
  }
}

async function writeProducts(list) {
  await fs.writeFile(productsFile, JSON.stringify(list, null, 2), "utf8");
}

const token = process.env.TOKEN;
const mytoken = process.env.MYTOKEN;

app.listen(process.env.PORT, () => {
  console.log("webhook is listening");
});

app.get("/webhook", (req, res) => {
  let mode = req.query["hub.mode"];
  let challange = Number(req.query["hub.challenge"]);
  console.log("Challenge: ", challange);
  let token = req.query["hub.verify_token"];

  if (mode && token) {
    if (mode === "subscribe" && token === mytoken) {
      res.status(200).send(challange);
    } else {
      res.status(403);
    }
  }
});

app.post("/webhook", async (req, res) => {
  let body_param = req.body;
  if (!body_param.object) return res.sendStatus(404);

  const messages =
    body_param.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!messages) return res.sendStatus(404);

  const phon_no_id = body_param.entry[0].changes[0].value.metadata.phone_number_id;
  const from = messages.from;
  const msg_body = messages.text?.body?.trim() || "";

  // Helper: send message
  const sendMessage = async (data) => {
    await axios.post(
      `https://graph.facebook.com/v13.0/${phon_no_id}/messages?access_token=${token}`,
      data,
      { headers: { "Content-Type": "application/json" } }
    ).catch((e) => console.error("send error", e));
  };

  // Check if it's a main command
  if (["menu", "options", "help", "hi", "hello"].includes(msg_body.toLowerCase()) || !msg_body) {
    const mainMenu = {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Welcome! Please choose an action:" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "add_product", title: "➕ Add Product" } },
            { type: "reply", reply: { id: "delete_product", title: "🗑️ Delete Product" } },
            { type: "reply", reply: { id: "view_products", title: "🛍️ View Products" } },
          ],
        },
      },
    };
    await sendMessage(mainMenu);
    return res.sendStatus(200);
  }

  // Handle button replies
  const buttonId = messages?.interactive?.button_reply?.id;
  let sendText = "";

  try {
    if (buttonId === "add_product" || msg_body.toLowerCase().startsWith("1")) {
      const parts = msg_body.split(",").map((p) => p.trim());
      if (parts.length < 4) {
        // Ask sequentially for missing info
        sendText = "Please send product in format: name,quantity,price";
      } else {
        const [_, name, qtyStr, priceStr] = parts;
        const qty = parseInt(qtyStr, 10) || 0;
        const price = parseFloat(priceStr) || 0;

        const products = await readProducts();
        const existing = products.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          existing.quantity += qty;
          existing.price = price;
        } else {
          products.push({ name, quantity: qty, price });
        }
        await writeProducts(products);
        sendText = `Added/updated product ${name} (qty: ${qty}, price: ${price})`;
      }
    } else if (buttonId === "delete_product" || msg_body.toLowerCase().startsWith("2")) {
      const parts = msg_body.split(",").map((p) => p.trim());
      if (parts.length < 2) {
        sendText = "Please send the product name to delete: 2,name";
      } else {
        const name = parts[1];
        let products = await readProducts();
        const before = products.length;
        products = products.filter(p => p.name.toLowerCase() !== name.toLowerCase());
        await writeProducts(products);
        sendText = products.length < before ? `Deleted product ${name}` : `Product ${name} not found`;
      }
    } else if (buttonId === "view_products" || msg_body === "3" || msg_body.toLowerCase() === "show") {
      const products = await readProducts();
      sendText = products.length === 0 ? "No products stored." : products.map(p => `${p.name} - qty: ${p.quantity} - price: ${p.price}`).join("\n");
    } else {
      sendText = "Please send a valid product format or use the menu buttons.";
    }
  } catch (err) {
    console.error(err);
    sendText = "An error occurred while processing your request.";
  }

  await sendMessage({
    messaging_product: "whatsapp",
    to: from,
    text: { body: sendText },
  });

  res.sendStatus(200);
});


app.get("/", (req, res) => {
  res.status(200).send("hello this is webhook setup");
});
