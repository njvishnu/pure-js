"use strict";

// var API_BASE_URL = "http://127.0.0.1:5000";
var API_BASE_URL;
const POLLING_INTERVAL = 5000; // poll every 5 seconds
const MAX_ATTEMPTS = 180; // Half an hour should be more than enough
const TEAM_MAP = new Map([['1','blue'], ['2','red'],['3','green']]);
const IMG_BASE = "assets/images/cards/";
const SOUND_BASE = "assets/images/sounds/";
const TWO_EYED_JACKS = ["diamonds","clubs"];
const ONE_EYED_JACKS = ["spades","hearts"];
const MAX_RETRY_ATTEMPTS = 20;

class RequestService {
    async getResponse(url, h, m, b, r) {
        let retries = r;
        while(true) {
            let data = await (await (fetch(url, { headers: h, method: m, body: b })
                .then((res) => {
                    if(!res.ok) {
                        if(retries == 0) {
                            console.log("Max attempts reached from server error");
                            //throw new Error("Max attempts reached");
                        } 
                        console.log("error")
                        throw new Error(res.statusText);
                    }
                    return res.json();  
                })
                .catch((err) => {
                    /* 
                    * This block is called only if the actual request fails. 
                    * For ex. Network failures, DNS Lookup failures, server down...
                    */
                   setTimeout(function() {}, 1000); // wait for 1 second
                   if(retries == 0) {
                       console.log("Max attempts reached from network error")
                       throw err;
                   }
                    console.log("Error in fetching data : " + err);
                })
            ));
            if(data) {
                return data;
            }
            retries--;
        }
        //return data;
    }
}

class Player {
    // Private fields are at the moment not supported
    token = '';
    id = '';
    user = '';
    team = '';
    constructor() {

    }

    /**
     * @param {string} team
     */
    set team(team) {
        self.team = team;
    }

    get team() {
        return self.team;
    }

    /**
     * @param {string} user
     */
    set user(user) {
        this.user = user;
    }

    get user() {
        return this.user;
    }

    /**
     * @param {string} token
     */
    set token(token) {
        this.token = token
    }
    get token() {
        return this.token
    }

    /**
     * @param {string} id
     */
    set id(id) {
        this.id = id
    }

    get id() {
        return this.id
    }

}

var req = new RequestService();
var player = null;
// Variable to check login state
var loginState = 0;
var startState = 0;
var previousState = null;
var jFlag = false;

// Generic poll function to get state and get updated bord data
const poll = async ({fn, interval, maxAttempt}) => {
	console.log('Polling starting');
	let attempt = 0;
	const exec = async (resolve, reject) => {
		attempt++;
		const response = await fn();
		if(response['message'] == "Ready") {
			return resolve(response);
        }
		else if (maxAttempt && attempt === maxAttempt) {
			return reject(new Error('Max Attempts exceeded'));
		}
		else {
			setTimeout(exec, interval, resolve, reject)
		}
	};
	return new Promise(exec);
};

window.onload = (event) => {
    // Let the poll begin
    const a = poll({
        fn: checkStart,
        interval: POLLING_INTERVAL,
        maxAttempt: 100000000
    }).then( (response) => {
        const a = poll({
            fn: getState,
            interval: POLLING_INTERVAL,
            maxAttempt: 10000000,
        });
    });
};

function checkStart() {
    let response;
    if(startState == 1) {
        response = '{"message":"Ready"}';
        return JSON.parse(response);
    }
    response = '{"message" : "Not started"}';
    return JSON.parse(response);
}

function getState() {
    let response ;
    if (loginState == 0) {
        // return "Ready" when user has logged out.
        response = '{"message":"Ready"}';
        return JSON.parse(response);
    }
    else {
        let url = API_BASE_URL + "/state";
        let headers = generateJsonHeader();
        headers.append("Authorization", "bearer " + player.token);
        let data = JSON.stringify({player:player.id});
        req.getResponse(url, headers, "POST", data, MAX_RETRY_ATTEMPTS).then( (response) => {   
            // Waiting means waiting for your turn. Others might have played.
            if(response["message"] == "Waiting") {
                handleWait(response);
            }
            else if(response["message"] == "Ready") {
                handleReady(response);
            }
            else if(response["message"] == "New") {
               handleNew(response);
            }
        });
        // send a dummy "processing" response so the poll promise is not resolved
        response = '{"message":"Processing"}';
        return JSON.parse(response);    
    }
}

function handleNew(response) {
    // cleanup all card state
    let h = document.querySelectorAll('.highlight');
    if(h!== null) {
        h.forEach( elem => {
            elem.classList.remove('highlight');
        });
    }
    
    // remove selected if it exists
    let sel = document.querySelector('.selected');
    if(sel !== null) {
        sel.classList.remove('selected');
    }

    // remove special if it exists
    let spec = document.querySelector('.special');
    if(spec !== null) {
        spec.classList.remove('special');
    }

    // remove all masks
    let b = document.querySelectorAll(".blue-mask");
    let g = document.querySelectorAll(".green-mask");
    let r = document.querySelectorAll(".red-mask");
    if ( b!== null) {
        b.forEach (elem => {
            elem.classList.remove('blue-mask');
        });
    }
    if ( g!== null) {
        g.forEach (elem => {
            elem.classList.remove('green-mask');
        });
    }
    if ( r!== null) {
        r.forEach (elem => {
            elem.classList.remove('red-mask');
        });
    }

    // cleanup players
    let list = document.querySelector('.players')
    if(list.innerHTML.trim() !== "") {
        list.innerHTML='';
    }

    // remove all cards
    let cardsContainer = document.querySelector('.cards-container'); // Maybe cardsContainer.innerHTML = '' ?
    while ( cardsContainer.firstChild ) {
        cardsContainer.removeChild( cardsContainer.firstChild );
    }

    // cleanup discard pile
    document.querySelector('.discard-pile').src = IMG_BASE + "empty.png";

    // disable all buttons
    document.querySelectorAll(".button").forEach( elem => {
        if( elem.classList.contains('play') || elem.classList.contains('draw') || elem.classList.contains('dead')) {
            elem.classList.add("disabled-button");
        }
    }); 

    initState(response);
    // Hack for me
    if ((player.user == 'vnj') || (player.user == 'VNJ')) {
        document.querySelector(".start").classList.remove("disabled-button")
    }
}

function handleReady(response) {
    // Need to compare since we are waiting
    if(!compareResp(previousState, response)) {
        previousState = response;
        // play sound
        let audio = document.getElementById("audio");
        audio.play();
        
        let card = translateCards(response["card"], "client");
        let deck = response["deck"];
        let next = response["next"];
        let team = response["team"].toString();
        let special = response["special"];
        // Remove highlights
        let pHighlighted = document.querySelector('.player-highlight');
        if(pHighlighted !== null) {
            pHighlighted.classList.remove('player-highlight');
        }
        let pl = document.querySelector('.list-' + next);
        if(pl !== null){
            pl.classList.add('player-highlight');
        }
        if(next == player.user) {
            document.querySelectorAll(".button").forEach( elem => {
                if( elem.classList.contains('play') || elem.classList.contains('draw') || elem.classList.contains('dead')) {
                    elem.classList.remove("disabled-button");
                }
            });
        }
        if(special != '') {
            let j = translateCards(response["special"], "client");
            document.querySelector('.discard-pile').src = IMG_BASE + j + ".png";
            if(TWO_EYED_JACKS.includes(j.split('_')[0])) {
                document.querySelector("." + card + "." + deck).classList.add(TEAM_MAP.get(team) + "-mask");
                let j = translateCards(special, "client");
            }
            else if(ONE_EYED_JACKS.includes(j.split('_')[0])) {
                let a = document.querySelector("." + card + "." + deck).classList[4];
                document.querySelector("." + card + "." + deck).classList.remove(a);
                let j = translateCards(special, "client");
            }
        }
        else {
            document.querySelector("." + card + "." + deck).classList.add(TEAM_MAP.get(team) + "-mask");
            document.querySelector('.discard-pile').src = IMG_BASE + card + ".png";
            // TODO update next player
        }
    }
}

function handleWait( response) {
    // Need to compare since the state might have changed while still "waiting" for turn
    if(!compareResp(previousState, response)) {
        previousState = response;
        // play sound
        let audio = document.getElementById("audio");
        audio.play();
        
        if(response["last"] != player.username) { // checking if last player was same as you
            let card = translateCards(response["card"], "client");
            let deck = response["deck"];
            let next = response["next"];
            let team = response["team"].toString();
            let special = response["special"];
            // Remove highlights
            let pHighlighted = document.querySelector('.player-highlight');
            if(pHighlighted !== null) {
                pHighlighted.classList.remove('player-highlight');
            }
            let pl = document.querySelector('.list-' + next);
            if(pl !== null){
                pl.classList.add('player-highlight');
            }
            if(special != '') {
                let j = translateCards(response["special"], "client");
                document.querySelector('.discard-pile').src = IMG_BASE + j + ".png";
                if(TWO_EYED_JACKS.includes(j.split('_')[0])) {
                    document.querySelector("." + card + "." + deck).classList.add(TEAM_MAP.get(team) + "-mask");
                    let j = translateCards(special, "client");
                }
                else if(ONE_EYED_JACKS.includes(j.split('_')[0])) {
                    let a = document.querySelector("." + card + "." + deck).classList[4];
                    document.querySelector("." + card + "." + deck).classList.remove(a);
                    let j = translateCards(special, "client");
                }
            }
            else {
                document.querySelector("." + card + "." + deck).classList.add(TEAM_MAP.get(team) + "-mask");
                document.querySelector('.discard-pile').src = IMG_BASE + card + ".png";
                // TODO update next player
            }
        }
        else {
            // this is a special case also in case you started the game and there is no state yet.
            document.querySelectorAll(".button").forEach( elem => {
                if( elem.classList.contains('play') || elem.classList.contains('draw') || elem.classList.contains('dead')) {
                    elem.classList.add("disabled-button");
                }
            });   
        }
    }
}

// event handler for user select
document.querySelector('.cards-container').addEventListener('click', function(e) {
    jFlag = false;
    if(e.target.classList.contains('hand-card')) {

        let h = document.querySelectorAll('.highlight');
        if(h!== null) {
            h.forEach( elem => {
                elem.classList.remove('highlight');
            });
        }
        
        // remove selected if it exists
        let sel = document.querySelector('.selected');
        if(sel !== null) {
            sel.classList.remove('selected');
        }

        // remove special if it exists
        let spec = document.querySelector('.special');
        if(spec !== null) {
            spec.classList.remove('special');
        }

        // Expecting the second class to be always the card name
        let cardSelected = e.target.classList[1];

        if(cardSelected.split("_")[1] == "J") {
            jFlag = true;
            e.target.classList.add('highlight');
            e.target.classList.add('special');
            
            if(ONE_EYED_JACKS.includes(cardSelected.split('_')[0])){
                let b = document.querySelectorAll(".blue-mask");
                let g = document.querySelectorAll(".green-mask");
                let r = document.querySelectorAll(".red-mask");
                if ( b!== null && player.team != "blue") {
                    b.forEach (elem => {
                        elem.classList.add('highlight');
                    });
                }
                if ( g!== null && player.team != "green") {
                    g.forEach (elem => {
                        elem.classList.add('highlight');
                    });
                }
                if ( r!== null && player.team != "red") {
                    r.forEach (elem => {
                        elem.classList.add('highlight');
                    });
                }
            }
            else if(TWO_EYED_JACKS.includes(cardSelected.split('_')[0])){
                document.querySelectorAll(".card").forEach(elem => {
                    let c = elem.classList;
                    if(!c.contains('empty') && !c.contains('blue-mask') 
                        && !c.contains('green-mask') && !c.contains('red-mask')) {
                        c.add('highlight');
                    }
                });
            }
        }
        else {
            let c = document.querySelectorAll('.' + cardSelected);
            if(c!==null) {
                c.forEach( elem => {
                    elem.classList.add('highlight');
                });
            }
        }
        
        // doing this because selected card has to be passed to server
        document.querySelector('.board').addEventListener('click', handlerBoard);
    }
});

function handlerBoard(ev) {
    let cList = ev.target.parentElement.classList;
    if(cList.contains('highlight')) {
        let sel = document.querySelector('.selected');
        if(sel !== null) {
            sel.classList.remove('selected');
            sel.classList.add('highlight');
        }
        cList.remove('highlight');
        cList.add('selected');
    }
    else {
        alert("Cannot select that card");
    }
}

function play(event) {
    if(event.target.classList.contains('disabled-button')) {
        return;
    }

    document.querySelector('.board').removeEventListener('click', handlerBoard);

    // Check if card is selected.
    let selection = document.querySelector('.selected');
    if(selection !== null) {
        let d;
        let card;
        let jType = '';
        d = selection.classList[3]; // this gets the deck
        card = selection.classList[2]; // same as selectedCard
        if(jFlag) {
            jType = translateCards(document.querySelector('.special').classList[1], "server");
        }

        let c = translateCards(card, "server" );
        let url = API_BASE_URL + "/play";
        let headers = generateJsonHeader();
        headers.append("Authorization", "bearer " + player.token);
        let data = JSON.stringify({player:player.id, card:c, deck:d, special:jType});
        
        req.getResponse(url, headers, "POST", data, MAX_RETRY_ATTEMPTS).then( (response) => {
            // play sound
            let audio = document.getElementById("audio");
            audio.play();

            //remove all highlihgts and selections
            let h = document.querySelectorAll('.highlight');
            if(h!==null) {
                h.forEach( elem => {
                    elem.classList.remove('highlight');
                });
            }
            selection.classList.remove("selected"); // there will be only one selected

            // remove card from player card list
            if(jFlag) {
                let s = document.querySelector('.special');
                if(s !== null) {
                    let cardContainer = s.parentElement;
                    cardContainer.parentElement.removeChild(cardContainer);
                    // Add to discard pile
                    document.querySelector('.discard-pile').src = IMG_BASE + s.classList[1] + ".png";
                }
                if(TWO_EYED_JACKS.includes(jType.split(":")[1].toLowerCase())) {
                    selection.classList.add(player.team + '-mask');
                }
                else if(ONE_EYED_JACKS.includes(jType.split(":")[1].toLowerCase())) {
                    if(selection.classList.contains('blue-mask') && player.team !='blue'){
                        selection.classList.remove('blue-mask');
                    }
                    
                    if(selection.classList.contains('green-mask') && player.team !='green'){
                        selection.classList.remove('green-mask');
                    }
                    
                    if(selection.classList.contains('red-mask') && player.team !='red'){
                        selection.classList.remove('red-mask');
                    }
                }
            }
            else {
                // add card to discard pile
                document.querySelector('.discard-pile').src = IMG_BASE + card + ".png";
                let handCard = document.querySelector(".hand-card." + card);
                if(handCard !== null) {
                    let cardContainer = handCard.parentElement;
                    cardContainer.parentElement.removeChild(cardContainer);
                }

                // Apply team mask
                selection.classList.add(player.team + '-mask');
            }

            document.querySelector('.play').classList.add('disabled-button');
            document.querySelector('.dead').classList.add('disabled-button');
            document.querySelector('.draw').classList.remove('disabled-button');
            // Cleanup
            jFlag = false;
            // Remove hightlight if it exists
            h = document.querySelectorAll('.highlight');
            if(h!== null) {
                h.forEach( elem => {
                    elem.classList.remove('highlight');
                });
            }
            
            // remove selected if it exists
            let sel = document.querySelector('.selected');
            if(sel !== null) {
                sel.classList.remove('selected');
            }

            // remove special if it exists
            let spec = document.querySelector('.special');
            if(spec !== null) {
                spec.classList.remove('special');
            }
        });
    }
    else {
        alert('Nothing selected');
    }
}

function compareResp(prev, cur) {
    if(previousState == null) {
        return false;
    }
    if( prev["team"] == cur["team"] 
        && prev["card"] == cur["card"] 
        && prev["deck"] == cur["deck"] 
        && prev["special"] == cur["special"]
        && prev["next"] == cur["next"]
        && prev["last"] == cur["last"]) {
            return true;
    }
    return false;
}

function draw(event) {
    if(event.target.classList.contains('disabled-button')) {
        return;
    }
    let url = API_BASE_URL + "/draw";
    let headers = generateJsonHeader();
    headers.append("Authorization", "bearer " + player.token);
    let data = JSON.stringify({player:player.id});
    req.getResponse(url,headers, "POST", data, MAX_RETRY_ATTEMPTS).then( (response) => {

        let card = translateCards( response['card'], "client");
        let cardsContainer = document.querySelector('.cards-container');

        let imgDiv = document.createElement("div");
        imgDiv.classList.add("hand");
        let img = document.createElement("img");
        img.classList.add("hand-card", card);
        img.src = IMG_BASE + card + ".png";
        imgDiv.appendChild(img);
        cardsContainer.appendChild(imgDiv);
    });
    document.querySelector('.draw').classList.add('disabled-button');
}

function loginUser(event) {
    player = new Player();
    let headers = generateJsonHeader();
    let u = document.querySelector(".user").value;
    let p = document.querySelector(".password").value;
    let h = document.querySelector(".host").value;
    if (h == "" || h.length == 0 || h == null || 
        u == "" || u.length == 0 || u == null ||
        p == "" || p.length == 0 || p == null ) {
        alert('Invalid input')
        return;
    }
    API_BASE_URL = h.replace(/\/$/, "");
    let data = JSON.stringify({ username: u, password: p });

    player.user = u;

    let url = API_BASE_URL + "/login";
    console.log(url);
    req
        .getResponse(url, headers, "POST", data, 1)
        .then( (response) => {
            loginState = 1;
            player.token = response['token'];
            player.id = response['id'];
            let elem = document.querySelector('.signin-modal');
            elem.parentElement.removeChild(elem);
            // Hack to enable start button for me/admin .
            if ((u == 'vnj') || (u == 'VNJ')) {
                document.querySelector(".start").classList.remove("disabled-button")
            }
            else {
                document.querySelector(".start").classList.add("remove-button");
            }
        }).then( () => {
            // Start polling for ready status
            url = API_BASE_URL + "/ready";
            headers = generateJsonHeader();
            headers.append("Authorization", "bearer " + player.token);
            let data = JSON.stringify({player:player.id});
            const a = poll({
                fn: () => req.getResponse(url, headers, "POST", data, MAX_RETRY_ATTEMPTS),
                interval: POLLING_INTERVAL,
                maxAttempt: 100
            }).then( (response) => {
                startState = 1;
                console.log("Round started by admin")
                document.querySelector('.message').innerHTML = "Game initialized";
                initState(response);
            }).catch(err => console.log(err));
        }).catch( error => {
            if(error.message === "UNAUTHORIZED" && loginState == 0 ) {
                alert("Incorrect username/password")
            }
            console.log(error);
        });
}

function initState(response) {
    let cards = response['cards']; // ["5:Spades", "King:Clubs",...]
    let teams = response['teams']; // { "1":["p1", "p4"], "2":["p2", "p5"], 3:["p3", "p6"]}
    let order = response['order']; // {"p1", "p2",..}
    let next = response['next']; // "next" : "p1"

    // Add cards to view
    cards = translateCards(cards, "client");
    let cardsContainer = document.querySelector('.cards-container');
    cardsContainer.innerHTML = '';
    cards.forEach(element => {
        let imgDiv = document.createElement("div");
        imgDiv.classList.add("hand");
        let img = document.createElement("img");
        img.classList.add("hand-card", element);
        img.src = IMG_BASE + element + ".png";
        imgDiv.appendChild(img);
        cardsContainer.appendChild(imgDiv);
    });

    let list = document.querySelector('.players')
    // Creates a map of players to team mapping
    let teamMap = new Map();
    for(var x in teams) {
        if(teams.hasOwnProperty(x)){
            teams[x].forEach(element => {
                teamMap.set(element, TEAM_MAP.get(x));
                if(element == player.user){
                    player.team = TEAM_MAP.get(x);
                }
            });
        }
    }

    //Adds player list
    order.forEach(element => {
        let elem = document.createElement("LI");
        elem.classList.add("list-" + teamMap.get(element), "list-" + element);
        elem.innerText = element;
        list.appendChild(elem);
    });

    
    let pHighlighted = document.querySelector('.player-highlight');
    if(pHighlighted !== null) {
        pHighlighted.classList.remove('player-highlight');
    }
    let pl = document.querySelector('.list-' + next);
    if(pl !== null){
        pl.classList.add('player-highlight');
    }

    if(next == player.user) {
        document.querySelectorAll('.button.disabled-button').forEach( elem => {
            if(!elem.classList.contains('start') && !elem.classList.contains('draw')){
                elem.classList.remove('disabled-button');
            }
        });
    }
}

// function to translate card format between server and client
function translateCards(cards, target) {
    if(target == "client" && cards.constructor === Array) {
        let c = [];
        cards.forEach(element => {
            let a = element.split(":")[0];
            if(["King", "Queen", "Jack", "Ace"].includes(a)) {
                a = a.charAt(0).toUpperCase();
            }
            c.push(element.split(":")[1].toLowerCase() + "_" + a);
        });
        return c;
    }

    if(target == "client") {
        let a = cards.split(":")[0];
        if(["King", "Queen", "Jack", "Ace"].includes(a)) {
            a = a.charAt(0).toUpperCase();
        }
        return cards.split(":")[1].toLowerCase() + "_" + a;
    }
    
    if(target == "server") {
        let face = cards.split("_")[1] // face for lack of better word
        // there will only be one card per request to server
        switch(face) {
            case "K" : face = "King"
                        break;
            case "Q" : face = "Queen"
                        break;
            case "J" : face = "Jack"
                        break;
            case "A" : face = "Ace"
                        break;
        }
        let suite = cards.split("_")[0];
        return face + ":" + suite.charAt(0).toUpperCase() + suite.slice(1);
    }
}

function startEnable(event) {

    document.querySelector('.start-container').classList.remove('start-container-hidden');
}

function start(event) {
    if(event.target.classList.contains('disabled-button')) {
        return;
    }

    // TODO Do validation
    let headers = generateJsonHeader();
    let e = document.querySelector(".team-count");
    let c = e.options[e.selectedIndex].value
    let url = API_BASE_URL + "/start";
    let data = JSON.stringify({ count: c });
    headers.append("Authorization", "bearer " + player.token);
    req.getResponse(url, headers, "POST", data, MAX_RETRY_ATTEMPTS).then((response) => {
        // assuming valid response
        // Just check if success
        document.querySelector('.start-container').classList.add('start-container-hidden');
    });
}

function newGame(event) {

    let url = API_BASE_URL + "/new";
    let headers = generateJsonHeader();
    headers.append("Authorization", "bearer " + player.token);
    let data = JSON.stringify({player:player.id});
    req.getResponse(url, headers, "POST", data, MAX_RETRY_ATTEMPTS).then( (response) => {
        alert("New game initialized!")
        document.querySelector('.start-container').classList.add('start-container-hidden');
    });

}

function logout() {
    let headers = generateJsonHeader();
    let url = API_BASE_URL + "/logout";
    let data;
    // The player id check is in case the game never started.
    if(player.id != '') {
        let p = player.id;
        data = JSON.stringify({player:p});
    }
    headers.append("Authorization", "bearer " + player.token);
    req.getResponse(url, headers, "POST", data, MAX_RETRY_ATTEMPTS).then((response) => {
        loginState = 0;
        console.log("Logged out");
        // Hack - since this is a single page app
        let elem = document.getElementById("root");
        elem.innerHTML = "<h1 style='font-size:100pt'>Later....</h1>";
    });
    delete player.id;
    delete player.token;
    delete player.user;
}

function checkDead(event) {
    if(event.target.classList.contains('disabled-button')) {
        return;
    }
    if(document.querySelector('.special') !== null) {
        alert("Jack cannot be dead!");
        return;
    }

    let a = document.querySelector('.hand-card.highlight');
    if(a !== null) {
        if(a.classList[2].split("_")[1] != 'J' ) { // Might not be necessary
            let flag = false;
            document.querySelectorAll('.board .highlight').forEach( elem => {
                if(!elem.classList.contains('blue-mask') 
                    && !elem.classList.contains('green-mask') 
                    && !elem.classList.contains('red-mask')) {
                        flag = true;
                }
            });
            if(flag) {
                alert('This card is not dead');
            }
            else {
                let c = a.classList[1];
                let headers = generateJsonHeader();
                let url = API_BASE_URL + "/dead";
                let data;
                let p = player.id;
                data = JSON.stringify({player:p, card:c});
                headers.append("Authorization", "bearer " + player.token);
                req.getResponse(url, headers, "POST", data, MAX_RETRY_ATTEMPTS).then((response) => {
                    let handCard = document.querySelector(".hand-card." + c);
                    if(handCard !== null) {
                        let cardContainer = handCard.parentElement;
                        cardContainer.parentElement.removeChild(cardContainer);
                    }
                    document.querySelector('.draw').classList.remove('disabled-button');
                    document.querySelector('.dead').classList.add('disabled-button');    

                    // Cleanup
                    let h = document.querySelectorAll('.highlight');
                    if(h!== null) {
                        h.forEach( elem => {
                            elem.classList.remove('highlight');
                        });
                    }
                    
                    // remove selected if it exists
                    let sel = document.querySelector('.selected');
                    if(sel !== null) {
                        sel.classList.remove('selected');
                    }
                });   
            }
        }
        else {
            alert("Jack cannot be dead!");
        }
    }
    else {
        alert('Nothing selected!');
    }
}

window.addEventListener('beforeunload', function(e) {
    // state is used to store login state. Display alert only if logged in.
    // TODO Maybe check for keyDown event for F5 refresh(code 116) ?
    if(loginState == 1) {
        loginState = 0;
        e.preventDefault();
        e.returnValue = 'onbeforeunload';
        logout();
        return "Logging you out!"
    }    
});

function generateJsonHeader() {
    return new Headers({
        "Content-Type": "application/json",
    });
}
nd