async function rpc_call(method, params) {
  let requestOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: new Date()
        .getTime(),
      method: method,
      params: params
    })
  };
  const request = await fetch("/rpc/", requestOptions);
  const json = await request.json();

  return json.result;
}

async function fetchMessages(contract_name, state, peak_height, range) {
  console.log("Fetching messages for peak", peak_height, range)
  if (!range) range = 100
  if (!peak_height) return [];
  let start_height;
  if (peak_height > 100)
    start_height = peak_height - 25000;
  else
    start_height = 0;
  const result = await rpc_call("contract.invoke", [
    contract_name,
    state,
    "get_messages",
    [start_height,
      peak_height
    ]
  ]);
  if (result.error) {
    return null;
  }
  return result.records.reverse();
}
export default {
  name: "App",
  methods: {
    unhex(s) {
      var arr = [];
      for (var i = 0; i < s.length; i += 2) {
        var c = s.substr(i, 2);
        arr.push(parseInt(c, 16));
      }
      return String.fromCharCode.apply(null, arr);
    },
    unixToDate(msg) {
      const dateTimeStr = new Date(
          msg["meta"]["timestamp"] * 1000
        )
        .toLocaleString();
      return dateTimeStr;
    },
    async mintCoin() {
      this.loading = true;
      let requestOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: new Date()
            .getTime(),
          method: "contract.mint",
          params: [this.contract_name, this.state.value, 1, parseInt(
              this.user_tx_fee *
              1000000000000) // convert into mojos
          ]
        })
      };
      const request = await fetch("/rpc/", requestOptions);
      const resp = await request.json();
      const status = resp.result;
      console.log("Got back", status);
      if (status.error == "FeeTooLowError") {
        alert("Sorry, your fee of " + this.user_tx_fee +
          " was too small. Please check the recommended fee below the send button."
        )
      } else if (status.error && status.error.includes("spendable balance")) {
        alert(
          "Sorry, your wallet balance is too low. Please send at least 0.001 XCH to this wallet"
        )
      } else {
        console.log("updated coins", this.my_coins.value, this.my_coins
          .value
          .length);
        this.wallet_info.value = await rpc_call("wallet.poke");
        this.mint_alert = true;
      }
      console.log("What's our wallet info: ", this.wallet_info);
      this
        .loading = false;

    },
    async sendMessage() {
      const msg = this.input;
      console.log(msg);
      this.loading = true;
      let requestOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: new Date()
            .getTime(),
          method: "contract.invoke",
          params: [this.contract_name, this.state.value,
            "send_message",
            [msg], 1, parseInt(this.user_tx_fee *
              1000000000000) // convert into mojos
          ]
        })
      };
      const request = await fetch("/rpc/", requestOptions);
      const resp = await request.json();
      const status = resp.result;
      console.log("Got back", status);
      if (status.error == "FeeTooLowError") {
        alert("Sorry, your fee of " + this.user_tx_fee +
          " was too small. Please check the recommended fee below the send button and try something closer to that."
        )
      } else if (status.error == "AlreadyInThePool") {
        alert(
          "You already have a message pending in mempool, please wait for the next block"
        )
      } else if (status.error == "ValueError") {
        alert(
          status.msg
        )
      } else {
        this.pending_message = status.data;
        this.sent_alert = true;

        this.wallet_info.value = await rpc_call("wallet.poke");
      }
      this.user_tx_fee = 0;
      this.input = "";
      this.loading = false;

    },

  },
  setup() {
    const { watchEffect, onMounted, ref, reactive, created } = Vue;
    const messages = ref(null);
    const messages_loading = ref(true);
    const wallet_info = ref({});
    const min_fee_per_cost = ref(null);
    const tx_fee = ref(null);
    const loading = ref(true);
    const connected = ref(true);
    const user_tx_fee = ref(0);
    const input = ref("");
    const my_coins = reactive([]);
    const state = reactive({});
    const mint_alert = ref(false);
    const sent_alert = ref(false);
    const pending_message = ref(null);
    const pending_message_status = ref("");
    let amount = 1;
    const contract_name = "chirp.clvm";
    const interval = setInterval(async () => {
      messages_loading.value = true;
      try {
        const updated_msgs = await fetchMessages(contract_name, state
          .value, wallet_info.value.state.peak.height, 1000);
      } catch (err) {
        connected.value = false;
        return
      }
      connected.value = true
      if (updated_msgs == null) {
        return
      } else {
        messages.value = updated_msgs;
      }
      messages_loading.value = false;
    }, 20000)
    onMounted(async () => {
      async function sync() {
        if (pending_message.value) {
          let status;
          try {
            status = await rpc_call("node.get_tx_status", [
              pending_message.value
            ])
          } catch (err) {
            connected.value = false;
            return
          }
          connected.value = true;
          console.log("tx status:", status, ":");
          if (status === "Confirmed") {
            const updated_msgs = await fetchMessages(contract_name,
              state
              .value, wallet_info.value.state.peak.height, 1000);
            if (updated_msgs == null) {
              return
            } else {
              messages.value = updated_msgs;
            }
            pending_message.value = null;
            pending_message_status.value = "";
            sent_alert.value = false;
          } else
            pending_message_status.value = status
        }
        wallet_info.value = await rpc_call("wallet.poke");
        state.value = { pk: wallet_info.value["public_key"] };
        let _min_fee_per_cost = wallet_info.value.state
          .mempool_min_fees
          .cost_5000000;
        if (_min_fee_per_cost) _min_fee_per_cost = parseInt(
          _min_fee_per_cost);
        else _min_fee_per_cost = 0;
        if (_min_fee_per_cost === 0) {
          if (wallet_info.value.state.mempool_max_total_cost -
            wallet_info.value.state.mempool_cost < 214320556) {
            _min_fee_per_cost = 6
          }
          if (wallet_info.value.is_simulator) {
            console.log("Farming a block as we're in simulator mode")
            await rpc_call("node.farm_block");
          }
        }

        console.log("Input is", input);
        const fee_per_send_msg_resp = await rpc_call(
          "contract.get_fee_for_invoke", [
            contract_name,
            state.value,
            _min_fee_per_cost,
            "send_message",
            !input.value ? "a message" : input.value,

          ]
        );
        const cost_per_send_msg = fee_per_send_msg_resp.fee;
        console.log("Cost per send is: ", cost_per_send_msg);
        min_fee_per_cost.value = _min_fee_per_cost
        tx_fee.value = (cost_per_send_msg.toFixed(
              2) /
            1000000000000)
          .toFixed(6);
        my_coins.value =
          await rpc_call("contract.get_coins", [
            contract_name,
            state.value,
            amount
          ]);
      }
      window.onbeforeunload = function() {
        return "Do you really want to refresh? You will lose current state and app syncs with blockchain every 15 seconds.";
      }
      setInterval(async () => {
        messages_loading.value = true;
        await sync()
        messages_loading.value = false;
      }, 10000)
      await sync();
      console.log("fetched wallet info", wallet_info.value);

      console.log("my coins", my_coins.value)
      messages.value =
        await fetchMessages(contract_name, state.value,
          wallet_info.value.state.peak.height);

      loading.value = false;
    });
    messages_loading.value = false;
    return {
      loading,
      state,
      amount,
      connected,
      interval,
      contract_name,
      messages,
      my_coins,
      wallet_info,
      min_fee_per_cost,
      tx_fee,
      user_tx_fee,
      messages_loading,
      input,
      mint_alert,
      sent_alert,
      pending_message,
      pending_message_status
    };
  },
  template: /*html*/ `
        <div v-if="!loading && connected" id="sidebar">
          <img style="float:left; margin-right: 10px" src="logo.svg" width="45" alt="Chirp - messaging dapp on Chia Network"/>
          <h1 style="float:left;">Chirp</h1>
          <div style="color: gray; float:left; padding-top:20px; padding-left:10px">A messaging dapp on Chia Network 🌱</div>
          <details class="profile">
    <summary>
    Your Public key: {{wallet_info.public_key.slice(2,8)}}...{{wallet_info.public_key.slice(-6)}}
    </summary>
<table>
<thead>
  <tr>
    <th>Name</th>
    <th>Value</th>
  </tr>
</thead>
<tbody>
  <tr v-for="(val, key) in wallet_info">
    <td>{{key}}</td>
    <td>{{val}}</td>
  </tr>
</tbody>
</table>

</details>
</div>
        <div v-if="!loading && connected" id="content">
          <h3>Messages <small v-if="messages_loading" style="color:gray"> Syncing...</small></h3>
          <div class="chat">
          <div class="messages-list">
            <template v-for="msg in messages" key="msg.meta.id">
              <div class="message">
              <label style="color:gray" tooltip="{{msg.state.pk}}">
              <small><strong style="color:black">@
              <span style="color:black:font-weight:bold">{{msg.state.pk.slice(2,8)}}...{{msg.state.pk.slice(-6)}}</span></strong> at {{unixToDate(msg)}}</small>
              </label>
              <br />
              <span>{{unhex(msg.data[0])}}</span>
              </div>
            </template>
            <strong v-if="!messages.length" style="color:gray; text-align:center;padding: 30px">No messages yet, send some!</strong>
          
          </div>
          
          </div>
          <div id="new-message">
          <h4>Send a new message</h4>
            <template v-if="my_coins.value.length > 0 ">
              <input type="text" v-model="input" style="border:1px solid; background-color: white;float:left;width:75%"/>
              <button :disabled="!input" v-on:click="sendMessage" type="submit" style="width:24%; text-align: center; margin-right:0; float:right; ">Send</button>
              <small v-if="sent_alert" style="float:left; color:red">Message sent, waiting for confirmation...<span v-if="pending_message_status" style="color:black">Current status: {{pending_message_status}}</span></small>
            </template>
            <template v-else>
              You don't have a chirp contract coin to send messages. <button :disabled="mint_alert" style="width:24%; text-align: center; margin-right:0; float:right; " v-on:click="mintCoin">Mint one</button>
              <small v-if="mint_alert" style="float:left; color:red">Coin mint sent, it will be minted in next few blocks <br><span style="color:gray">(no need to refresh the page, it syncs itself every 15 secs)</span></small>
            </template>
            <div style="float: right; font-size: 0.7em;width:200px; text-align:right; clear:right">
              <label  style="padding-right: 10px; line-height:1.5; vertical-align:middle; ">Enter tx fee: </label>
              <input type="number" :style="user_tx_fee < tx_fee && input !== '' ? { 'border': '1px solid red' } : { }" class="tx_fee_input" v-model="user_tx_fee"/>    
            </div>
            <div style="float:right; font-size:0.7em;clear:both" v-if="tx_fee!== null">
              Recommended fee: {{tx_fee}} XCH
                    <br><small style="clear:both; padding:2px; float:right;color:silver">(current min fee per cost: {{min_fee_per_cost}} mojos)</small>
            </div>
                  <div style="float:right; font-size:0.7em;clear:both; color:gray;" v-else>calculating recommended fees...
                  </div>
                  
          </div>
        </div>
        <div style="top:30%" v-if="loading && connected">
           <span style="font-family: monospace;text-align:center; position:absolute; width:250px; top:50%; left:50%; margin: -220px 0 0 -120px">Blockchaining...</span>
           <img class="image" src="/dapp/chialisp.svg" width="120" height="120"  />
        </div>
        <div style="top:30%" v-if="!connected">
           <span style="font-family: monospace;text-align:center; position:absolute; width:250px; top:50%; left:50%; margin: -220px 0 0 -120px">Cannot connect to coinman. Is it running?
           <br>
           <span style="font-size:5em; clear:both; padding: 10px; margin:10px;">🔌</span>
           </span>
        </div>
    `
};
