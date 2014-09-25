var client = require('socket.io-client');

module.exports = MilkCocoa;

function MilkCocoa(host, cb) {
    this.host = format_host(host);
    this.milfeeSocket = new MilfeeSocket(this.host, cb);
}

var eventnames = {
    callback : "a",
    push : "b",
    set : "c",
    remove : "d",
    send : "e"
}

MilkCocoa.prototype = {
    auth : function(token, cb) {
        var self = this;
        var params = { token : token };
        do_ajax("POST", self.host + "account-api/auth", params, function(data) {
            this.milfeeSocket.disconnect();
            milfeeSocket = new MilfeeSocket(self.host, function() {
                cb(data.err, data.user);
            });
        });
    },
    addAccount : function(email,secret,option,cb) {
        var params = {  email : email, secret : secret, option : option};
        this.milfeeSocket.send_and_callback("signup",params,function(data) {
            cb(data.err, data.user);
        });
    },
    login : function(email, secret, cb) {
        var self = this;
        var params = { email : email, secret : secret };
        do_ajax("POST", self.host + "account-api/login", params, function(data) {
            if(data.user) {
                this.milfeeSocket.disconnect();
                milfeeSocket = new MilfeeSocket(self.host, function() {
                    cb(data.err, data.user);
                });
            }else{
                cb(data.err, data.user);
            }
        });
    },
    anonymous : function(cb) {
        var self = this;
        do_ajax("POST", self.host + "account-api/anonymous", {}, function(data) {
            this.milfeeSocket.disconnect();
            milfeeSocket = new MilfeeSocket(self.host, function() {
                cb(data.err, data.user);
            });
        });
    },
    logout : function(cb) {
        var self = this;
        var params = {};
        do_ajax("POST", self.host + "account-api/logout", params, function(data) {
            this.milfeeSocket.disconnect();
            milfeeSocket = new MilfeeSocket(self.host, function() {
                if(cb) cb(data.err);
            });
        });
    },
    getCurrentUser : function(cb) {
        this.milfeeSocket.send_and_callback("getcurrentuser", {}, function(data) {
            cb(data.err,data.user);
        });
    },
    dataStore : function(path) {
        return new DataStore(this.milfeeSocket, path);
    }
}

function DataStore(milfeeSocket, path) {
    this.milfeeSocket = milfeeSocket;
    this.path = pathutil.norm(path);
    this.data = null;
}

DataStore.prototype = {
    send: function(value, onComplete) {
        var params = { path : this.path, value : value};
        this.milfeeSocket.send_and_callback("send", params, onComplete);
    },
    off: function(event) {
        milfeeSocket.off(event,this.path);
        var params = { path : this.path, event : event};
        this.milfeeSocket.send("off",params);
    }
    ,on: function(event, cb) {
        this.milfeeSocket.on(event, this.path, cb);
    }
    ,push: function(value, onComplete) {
        var id = this.milfeeSocket.idGenerator.getNextId();
        var params = { path : this.path, value : value, id : id};
        this.milfeeSocket.send_and_callback("push",params,onComplete);
        return new DataStore(this.milfeeSocket, pathutil.norm(this.path + "/" + id));
    }
    ,remove: function(id, onComplete) {
        var params = { path : this.path + "/" + id};
        this.milfeeSocket.send_and_callback("unset",params,onComplete);
    }
    ,set: function(id, value, onComplete) {
        var params = { path : this.path + "/" + id, value : value};
        this.milfeeSocket.send_and_callback("set",params,onComplete);
    }
    ,query: function(query) {
        var params = { path : this.path, query : query};
        return new Query(this.milfeeSocket, params);
    }
    ,get: function(id, cb) {
        var path = this.path;
        if(typeof id == "function") {
            cb = id;
        }else if(typeof id == "string") {
            path = path + "/" + id;
        }else{
            throw new Error("invalid id type");
        }
        var params = { path : path };
        this.milfeeSocket.send_and_callback("get",params,function(data) {
            cb(data);
        });
    }
    ,getPath: function() {
        return this.path;
    }
    ,parent: function() {
        return new DataStore(this.milfeeSocket, pathutil.parent(this.path));
    }
    ,child: function(query) {
        return new DataStore(this.milfeeSocket, pathutil.norm(this.path + "/" + query));
    }
    ,root: function() {
        return new DataStore(this.milfeeSocket, "/");
    }
}

function Query(milfeeSocket, params) {
    this.milfeeSocket = milfeeSocket;
    this.params = params;
    this.params.option = { };
}

Query.prototype = {
    done: function(cb) {
        this.milfeeSocket.send_and_callback("fm",this.params,function(data) {
            cb(data);
        });
    }
    ,skip: function(skip) {
        if(!(typeof skip == "number")) {
            console.warn("invalid skip parameter.");
        }
        this.params.option.skip = skip;
        return this;
    }
    ,sort: function(_mode) {
        var mode = _mode || "desc";
        if(mode == "asc") {
            this.params.option.sort = "$natural";
        }else if(mode == "desc") {
            this.params.option.desc = "$natural";
        }else{
            console.warn("undefined sort mode.");
            console.log("usage : sort(\"desc\")");
        }
        return this;
    }
    ,asc : function() {
        return this.sort("asc");
    }
    ,desc : function() {
        return this.sort("desc");
    }
    ,desort: function(attr) {
        this.params.option.desc = attr;
        return this;
    }
    ,limit: function(n) {
        this.params.option.limit = n;
        return this;
    }
}


function MilfeeSocket(host, init_cb) {
    var self = this;
    this.app_id = host.split('.')[0];
    this.callback_id = 0;
    this.callbacks = {};
    this.listeners = {
        push : {},
        set : {},
        remove : {},
        send : {}
    };
    this.host = host;
    this.socket = client.connect(host, {
        'reconnect': true,
        'reconnection delay': 500,
        'max reconnection attempts': 10,
        'force new connection': true,
        "transport": "websocket"
    });
    this.reconnect_count = 0;
    this.queue = [];
    this.mode = 'offline';  //online or offline
    this.idGenerator = new IdGenerator();
    this.socket.on('connect', function() {
        console.log('connected');
        self.reconnect_count++;
        if(self.reconnect_count <= 1) {
            if(init_cb) init_cb();
        }
        self.socket.on('init', function(data) {
            self.idGenerator.init(data.ts);
            self.fire_operations();
        });
        self.socket.on(eventnames.callback, function(a) {
            var callbackid = "a" + String(a.callback_id);
            if(self.callbacks[callbackid]) {
                self.callbacks[callbackid](a.docs);
            }
        });
        self.socket.on(eventnames.push, function(a) {
            for(var i=0;i < self.listeners.push[a.sys.path].length;i++) {
                self.listeners.push[a.sys.path][i](a);
            }
        });
        self.socket.on(eventnames.set, function(a) {
            for(var i=0;i < self.listeners.set[a.sys.path].length;i++) {
                self.listeners.set[a.sys.path][i](a);
            }
        });
        self.socket.on(eventnames.remove, function(a) {
            for(var i=0;i < self.listeners.remove[a.sys.path].length;i++) {
                self.listeners.remove[a.sys.path][i](a);
            }
        });
        self.socket.on(eventnames.send, function(a) {
            for(var i=0;i < self.listeners.send[a.sys.path].length;i++) {
                self.listeners.send[a.sys.path][i](a);
            }
        });
    });
}

MilfeeSocket.prototype.disconnect = function() {
    if(this.socket) {
        this.socket.disconnect();
    }
}

MilfeeSocket.prototype.getAppID = function() {
    return this.app_id;
}

MilfeeSocket.prototype.online = function() {
    if(this.mode == 'offline') {
        //切り替え
    }
}

MilfeeSocket.prototype.offline = function() {
    if(this.mode == 'online') {
        //切り替え
        this.fire_operations();
    }
}

MilfeeSocket.prototype.fire_operations = function() {
    var self = this;
    for(var i=0;i < self.queue.length;i++) {
        if(self.queue[i].method == "s") {
            self.send(self.queue[i].event, self.queue[i].packet);
        }else if(self.queue[i].method == "sac") {
            self.send_and_callback(self.queue[i].event, self.queue[i].packet, self.queue[i].cb);
        }
    }
    self.queue = [];
}

MilfeeSocket.prototype.reset_on = function() {
    var self = this;
    for(var event in this.listeners) {
        for(var path in this.listeners[event]) {
            this.listeners[event][path].forEach(function(listener) {
                self.on(event, path, listener);
            });
        }
    }
}

MilfeeSocket.prototype.on = function(event, path, listener) {
    if(!this.listeners[event].hasOwnProperty(path)) {
        this.listeners[event][path] = [];
    }
    this.listeners[event][path].push(listener);
    var params = { event : event, path : path};
    this.send("on", params);
}

MilfeeSocket.prototype.off = function(event, path) {
    this.listeners[event][path] = [];
}

MilfeeSocket.prototype.send = function(event, packet) {
    if(this.reconnect_count == 0) {
        this.queue.push({
            method : "s",
            event : event,
            packet : packet
        });
        return;
    }
    this.socket.emit(event, packet);
}

MilfeeSocket.prototype.send_and_callback = function(event, packet, cb) {
    if(this.reconnect_count == 0) {
        this.queue.push({
            method : "sac",
            event : event,
            packet : packet,
            cb : cb
        });
        return;
    }
    packet.callback_id = this.callback_id;
    this.callbacks["a" + String(this.callback_id)] = cb;
    this.socket.emit(event, packet);
    this.callback_id++;
}

var pathutil = {
    norm : function(path) {
        var a = path.split('/');
        var b = [];
        for(var i=0;i < a.length;i++) {
            if(a[i] != '') {
                b.push(a[i]);
            }
        }
        return b.join('/');
    },
    parent : function(path) {
        var a = path.split('/');
        a.pop();
        return a.join('/');
    }
}

var shuffle_table = 'ybfghijam6cpqdrw71nx34eo5suz0t9vkl28';
function IdGenerator() {
    this.timestamp = new Date().getTime();
    this.id_header = this.getHeader(this.timestamp);
    this.prev_id = 0;
}
IdGenerator.prototype = {
    init : function(ts) {
        this.timestamp = ts;
        this.id_header = this.getHeader(this.timestamp);
    },
    getHeader : function(t) {
        return t.toString(36);
    },
    getHash : function(time) {
        var h = '';
        var t = time;
        while(t > 0) {
            h += shuffle_table[t % 36];
            t = t/36;
            t = Math.floor(t);
        }
        return h;
    },
    getNextId : function() {
        this.prev_id++;
        return this.id_header + add04(this.prev_id.toString(36)) + shuffle_table[Math.floor(Math.random() * 36)] + shuffle_table[Math.floor(Math.random() * 36)] + shuffle_table[Math.floor(Math.random() * 36)];
        function add04(str) {
            var str2 = str;
            for(var i=0;i < 4-str.length;i++) {
                str2 = "0" + str2;
            }
            return str2;
        }
    }
}

function format_host(host) {
    if(host[host.length - 1] === "/") {
        return host;
    }else{
        return host + "/";
    }
}

function do_ajax(method, url, params, onsuccess) {
    var xhr = null;
    if(window.XMLHttpRequest) {
        xhr = new XMLHttpRequest();
    }else if( window.XDomainRequest ){
        xhr = new XDomainRequest();
    }
    xhr.open(method , url);
    xhr.withCredentials = true;
    xhr.onload = function() {
        onsuccess(JSON.parse(xhr.responseText));
    }
    var params_str = querystring(params);
    xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
    xhr.send(params_str);

    function querystring(params) {
        var params_array = []
        for(var key in params) {
            params_array.push(key + "=" + encodeURIComponent(params[key]));
        }
        return params_array.join("&");
    }
}
