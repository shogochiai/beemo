var MilkCocoa = require('./milkcocoa');

var milkcocoa = new MilkCocoa('https://io-fi0i1mtqo.mlkcca.com');

var ds = milkcocoa.dataStore("test");

ds.push({"test":"test"}, function(e){
    console.log(e);
});
