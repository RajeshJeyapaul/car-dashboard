
'use strict';

require( 'dotenv' ).config( {silent: true} );

var express = require( 'express' );  // app server
var bodyParser = require( 'body-parser' );  // parser for post requests
var watson = require( 'watson-developer-cloud' );  // watson sdk
var http = require('http');

// The following requires are needed for logging purposes
var uuid = require( 'uuid' );
var vcapServices = require( 'vcap_services' );
var basicAuth = require( 'basic-auth-connect' );

// The app owner may optionally configure a cloudand db to track user input.
// This cloudand db is not required, the app will operate without it.
// If logging is enabled the app must also enable basic auth to secure logging
// endpoints
var cloudantCredentials = vcapServices.getCredentials( 'cloudantNoSQLDB' );
var cloudantUrl = null;
if ( cloudantCredentials ) {
  cloudantUrl = cloudantCredentials.url;
}
cloudantUrl = cloudantUrl || process.env.CLOUDANT_URL; // || '<cloudant_url>';
var logs = null;
var app = express();

// Bootstrap application settings
app.use( express.static( './public' ) ); // load UI from public folder
app.use( bodyParser.json() );

//Get the required credentials from vcapServices
var conversation_credentials = vcapServices.getCredentials('conversation');
var nlu_credentials = vcapServices.getCredentials('natural-language-understanding');
var weatherCredentials = vcapServices.getCredentials('weatherinsights');
// Create the service wrapper
var conversation = watson.conversation( {
  url: 'https://gateway.watsonplatform.net/conversation/api',
  username: conversation_credentials.username || '',
  password: conversation_credentials.password || '',
  version_date: '2016-07-11',
  version: 'v1'
} );

/********* NLU *************/
var NaturalLanguageUnderstandingV1 = require('watson-developer-cloud/natural-language-understanding/v1.js');
var nlu = new NaturalLanguageUnderstandingV1({
	username: nlu_credentials.username || '',			//Replace with your NLU Service username
	password: nlu_credentials.password || '',									//Replace with your NLU Service password
	'version_date': '2017-02-27'
	});

var weatherURL = weatherCredentials.url;
var weather = require('./lib/weather.js')(weatherURL);

// Endpoint to be call from the client side
app.post( '/api/message', function(req, res) {
  var workspace = process.env.WORKSPACE_ID || '';
  if ( !workspace || workspace === '<workspace-id>' ) {
    return res.json( {
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' +
        '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' +
        'Once a workspace has been defined the intents may be imported from ' +
        '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    } );
  }
  var payload = {
    workspace_id: workspace,
    context: {},
    input: {}
  };

  if ( req.body ) {
    if ( req.body.input ) {
      payload.input = req.body.input;

    }
    if ( req.body.context ) {
      // The client must maintain context/state
      payload.context = req.body.context;
    }
  }

 if (payload.input.text != '')
	{
	//console.log('input text payload = ', payload.input.text);
	 	var parameters = {
		  'text': payload.input.text,
		  'features': {
		    'entities': {
		      'emotion': true,
		      'sentiment': true,
		      'limit': 2
		    			},
		    'keywords': {
		      'emotion': true,
		      'sentiment': true,
		      'limit': 2
		    			}
		  			}
				}


	 	nlu.analyze(parameters, function(err, response) {
	  		if (err)
	  			{
		    console.log('error:', err);}
	  		else
	  		{
			 var nlu_output=response;

			 payload.context['nlu_output']=nlu_output;

			 // identify location
			 var entities = nlu_output.entities;
		     var location = entities.map(function(entry) {
		        if(entry.type == "Location") {
		               return(entry.text);
		             }
		        });
		        location = location.filter(function(entry) {
		      	  if(entry != null) {
		      		  return(entry);
		      	  }
		        	});
		        if(location.length > 0) {
		      	  payload.context['Location'] = location[0];
		      	  console.log('Location = ',payload.context['Location']);
		        				} else {
		        	  payload.context['Location']='';
		        						  }

		        // Send the input to the conversation service

		        conversation.message(payload, function(err, data) {
			                if (err) {
			                  return res.status(err.code || 500).json(err);
			                }
			                //return res.json(updateMessage(payload, data));
			                //updateResponse(res, data);
			                var weatherflag = checkWeather(data);
			                if(weatherflag) {

			              	   if(data.context.appCity != null) {
			              		   weatherApiCall(data,"current",function(error,data)
			              			{
			              			   if (error)
			              				   {return res.status(err.code || 500).json(err);}
			              			   else
			              				   {
			              				 console.log('data: ' + JSON.stringify(data));
			              				 return res.json(data);
			              				   }

			              			}
			              		   );

			              	   }
			                }
			                else
			                	{
			                return res.json(data);
			                	}
         				});
	  			}

	  		});
	 	}
 		//first time call, welcome message
 		else
 		{
		conversation.message(payload, function(err, data) {
			if (err) {
				return res.status(err.code || 500).json(err);
			}else{
				console.log('conversation.message :: ',JSON.stringify(data));
				return res.json(data);
			}
		});
		}
} );



function weatherApiCall(data,method,callback) {
  var onResponse = function (error, body) {
    if (error) {
    	if (error==='NA')
    	{
    	data.output.text="Could not find the location";
    	callback(null,data);
    	}
    	else
    		{
    	console.log('error: ' + error);
    	callback(error,null);}
    }

    else {
    	console.log('body: ' + body);

		   var append_weather_response = (data.context.append_response &&
					data.context.append_response === true) ? true : false;
		   if (append_weather_response ===true)
			   {
			   	if(data.output.text){
			   	var appendText="The weather in " + data.context.appCity + " is " +body.observation.wx_phrase;
			   	appendText +=". The temperature is " +body.observation.temp + " degree celcius";
				data.output.text=appendText;
			   	}
			   }


		   callback(null,data);

    }
  };
  // ?q=  will be first sent to autocomplete to guess the location
  // or ?latitude=&longitude= will go through
  if (data.context.appCity) {

    weather[method + "ByQuery"](data.context.appCity, {}, onResponse);
  } else {
    weather[method + "ByGeolocation"](parseFloat(req.query.latitude), parseFloat(req.query.longitude), {}, onResponse);
  }
}






function checkWeather(data) {
  //return (data.context != null) && (data.context.appCity != null) && (data.context.appST != null);
  return data.intents && data.intents.length > 0 && data.intents[0].intent === 'weather'
     && (data.context != null) && (data.context.appCity != null);
};



if ( cloudantUrl ) {
  // If logging has been enabled (as signalled by the presence of the cloudantUrl) then the
  // app developer must also specify a LOG_USER and LOG_PASS env vars.
  if ( !cloudantCredentials.username || !cloudantCredentials.password ) {
    throw new Error( 'LOG_USER OR LOG_PASS not defined, both required to enable logging!' );
  }
  // add basic auth to the endpoints to retrieve the logs!
  var auth = basicAuth( cloudantCredentials.username, cloudantCredentials.password );
  // If the cloudantUrl has been configured then we will want to set up a nano client
  var nano = require( 'nano' )( cloudantUrl );
  // add a new API which allows us to retrieve the logs (note this is not secure)
  nano.db.get( 'car_logs', function(err) {
    if ( err ) {
      console.error(err);
      nano.db.create( 'car_logs', function(errCreate) {
        console.error(errCreate);
        logs = nano.db.use( 'car_logs' );
      } );
    } else {
      logs = nano.db.use( 'car_logs' );
    }
  } );

  // Endpoint which allows deletion of db
  app.post( '/clearDb', auth, function(req, res) {
    nano.db.destroy( 'car_logs', function() {
      nano.db.create( 'car_logs', function() {
        logs = nano.db.use( 'car_logs' );
      } );
    } );
    return res.json( {'message': 'Clearing db'} );
  } );

  // Endpoint which allows conversation logs to be fetched
  app.get( '/chats', auth, function(req, res) {
    logs.list( {include_docs: true, 'descending': true}, function(err, body) {
      console.error(err);
      // download as CSV
      var csv = [];
      csv.push( ['Question', 'Intent', 'Confidence', 'Entity', 'Output', 'Time'] );
      body.rows.sort( function(a, b) {
        if ( a && b && a.doc && b.doc ) {
          var date1 = new Date( a.doc.time );
          var date2 = new Date( b.doc.time );
          var t1 = date1.getTime();
          var t2 = date2.getTime();
          var aGreaterThanB = t1 > t2;
          var equal = t1 === t2;
          if (aGreaterThanB) {
            return 1;
          }
          return  equal ? 0 : -1;
        }
      } );
      body.rows.forEach( function(row) {
        var question = '';
        var intent = '';
        var confidence = 0;
        var time = '';
        var entity = '';
        var outputText = '';
        if ( row.doc ) {
          var doc = row.doc;
          if ( doc.request && doc.request.input ) {
            question = doc.request.input.text;
          }
          if ( doc.response ) {
            intent = '<no intent>';
            if ( doc.response.intents && doc.response.intents.length > 0 ) {
              intent = doc.response.intents[0].intent;
              confidence = doc.response.intents[0].confidence;
            }
            entity = '<no entity>';
            if ( doc.response.entities && doc.response.entities.length > 0 ) {
              entity = doc.response.entities[0].entity + ' : ' + doc.response.entities[0].value;
            }
            outputText = '<no dialog>';
            if ( doc.response.output && doc.response.output.text ) {
              outputText = doc.response.output.text.join( ' ' );
            }
          }
          time = new Date( doc.time ).toLocaleString();
        }
        csv.push( [question, intent, confidence, entity, outputText, time] );
      } );
      res.csv( csv );
    } );
  } );
}

module.exports = app;
