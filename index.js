const express=require("express");
const body_parser=require("body-parser");
const axios=require("axios");
require('dotenv').config();

const fs=require('fs').promises;
const path=require('path');

const app=express().use(body_parser.json());

const productsFile = path.join(__dirname, 'products.json');

async function ensureProductsFile(){
    try{
        await fs.access(productsFile);
    }catch(e){
        await fs.writeFile(productsFile, '[]', 'utf8');
    }
}

async function readProducts(){
    await ensureProductsFile();
    const raw = await fs.readFile(productsFile,'utf8');
    try{
        return JSON.parse(raw || '[]');
    }catch(e){
        return [];
    }
}

async function writeProducts(list){
    await fs.writeFile(productsFile, JSON.stringify(list,null,2),'utf8');
}

const token=process.env.TOKEN;
const mytoken=process.env.MYTOKEN;

app.listen(process.env.PORT,()=>{
    console.log("webhook is listening");
});

app.get("/webhook",(req,res)=>{
   let mode=req.query["hub.mode"];
   let challange=Number(req.query["hub.challenge"]) ;
   console.log("Challenge: ",challange);
   let token=req.query["hub.verify_token"];


    if(mode && token){

        if(mode==="subscribe" && token===mytoken){
            res.status(200).send(challange);
        }else{
            res.status(403);
        }

    }

});

app.post("/webhook", async (req,res)=>{  

    let body_param=req.body;

    console.log(JSON.stringify(body_param,null,2));

    if(body_param.object){
        console.log("inside body param");
        if(body_param.entry && 
            body_param.entry[0].changes && 
            body_param.entry[0].changes[0].value.messages && 
            body_param.entry[0].changes[0].value.messages[0]  
            ){
               let phon_no_id=body_param.entry[0].changes[0].value.metadata.phone_number_id;
               let from = body_param.entry[0].changes[0].value.messages[0].from; 
               let msg_body = body_param.entry[0].changes[0].value.messages[0].text.body;

               console.log("phone number "+phon_no_id);
               console.log("from "+from);
               console.log("boady param "+msg_body);

               const text = (msg_body||'').trim();
               const menuText = "Options:\n1 - Add product: send '1,name,quantity,price'\n2 - Delete product: send '2,name'\n3 - Show all products: send '3'";

               let sendText = null;

               try{
                   if(!text){
                       sendText = menuText;
                   } else if(["menu","options","help","hi","hello"].includes(text.toLowerCase())){
                       sendText = menuText;
                   } else if(text.startsWith('1') || text.toLowerCase().startsWith('add')){
                       const parts = text.split(',').map(p=>p.trim());
                       if(parts.length<4){
                           sendText = "To add a product send: 1,name,quantity,price";
                       }else{
                           const name = parts[1];
                           const qty = parseInt(parts[2],10) || 0;
                           const price = parseFloat(parts[3]) || 0;
                           const products = await readProducts();
                           const existing = products.find(p=>p.name.toLowerCase()===name.toLowerCase());
                           if(existing){
                               existing.quantity = (existing.quantity||0) + qty;
                               existing.price = price;
                           }else{
                               products.push({name,quantity:qty,price});
                           }
                           await writeProducts(products);
                           sendText = `Added/updated product ${name} (qty: ${qty}, price: ${price})`;
                       }
                   } else if(text.startsWith('2') || text.toLowerCase().startsWith('delete')){
                       const parts = text.split(',').map(p=>p.trim());
                       if(parts.length<2){
                           sendText = "To delete a product send: 2,name";
                       }else{
                           const name = parts[1];
                           let products = await readProducts();
                           const before = products.length;
                           products = products.filter(p=>p.name.toLowerCase()!==name.toLowerCase());
                           await writeProducts(products);
                           sendText = (products.length<before) ? `Deleted product ${name}` : `Product ${name} not found`;
                       }
                   } else if(text==='3' || text.toLowerCase()==='show'){
                       const products = await readProducts();
                       if(products.length===0){
                           sendText = 'No products stored.';
                       }else{
                           sendText = products.map(p=>`${p.name} - qty: ${p.quantity} - price: ${p.price}`).join('\n');
                       }
                   } else {
                       // default echo
                    //    sendText = "Hi.. I'm hamoo, your message is "+msg_body;
                    sendText = null;
                    const fallbackMessage = {
                        messaging_product: "whatsapp",
                        to: from,
                        type: "interactive",
                        interactive: {
                            type: "button",
                            body: {
                                text: "Hello 👋\nWelcome to ABC Services! How can we help you today?\n\nPlease choose an option below:"
                            },
                            action: {
                                buttons: [
                                    {
                                        type: "reply",
                                        reply: {
                                            id: "track_order",
                                            title: "📦 Track My Order"
                                        }
                                    },
                                    {
                                        type: "reply",
                                        reply: {
                                            id: "talk_support",
                                            title: "💬 Talk to Support"
                                        }
                                    },
                                    {
                                        type: "reply",
                                        reply: {
                                            id: "view_products",
                                            title: "🛍️ View Products"
                                        }
                                    }
                                ]
                            }
                        }
                    };

                    axios({
                        method: "POST",
                        url: "https://graph.facebook.com/v13.0/" + phon_no_id + "/messages?access_token=" + token,
                        data: fallbackMessage,
                        headers: {
                            "Content-Type": "application/json"
                        }
                    }).catch(e => console.error('send error', e));

                    res.sendStatus(200);
                    return;

                
                }
               }catch(err){
                   console.error('product handling error',err);
                   sendText = 'An error occurred handling your request.';
               }

               axios({
                   method:"POST",
                   url:"https://graph.facebook.com/v13.0/"+phon_no_id+"/messages?access_token="+token,
                   data:{
                       messaging_product:"whatsapp",
                       to:from,
                       text:{
                           body: sendText
                       }
                   },
                   headers:{
                       "Content-Type":"application/json"
                   }

               }).catch(e=>console.error('send error',e));

               res.sendStatus(200);
            }else{
                res.sendStatus(404);
            }

    }

});

app.get("/",(req,res)=>{
    res.status(200).send("hello this is webhook setup");
});